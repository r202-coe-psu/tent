import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';
import { NotFoundError } from '$lib/utils/errors';
import { endpointStore } from '$lib/stores/endpoint.svelte';
import { catalogRepository } from '$lib/features/catalog';
import type { OperationsRepository } from '$lib/features/operations';
import type {
	BulkReturnEntry,
	BulkReturnEntryLoanRef,
	BulkReturnEntryMove,
	BulkReturnPoolV3,
	BulkReturnLoanDriftReason,
	DistributionLog
} from '../../domain/food-supplies';
import {
	applyBulkEntryToLog,
	assessBulkReturnRefOnLoan,
	buildSnapshotPins,
	deriveLoanReopenId,
	foldEntryMoves,
	resolveBulkReturnEntries,
	revertBulkEntryFromLog,
	selectOutstandingLoans
} from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	type BulkReturnEventRepository,
	BulkReturnPoolV3RemoteRepository,
	type BulkReturnPoolV3Repository,
	DistributionLogRemoteRepository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import type { CanonicalUnitCatalogRepository } from './canonical-unit';
import {
	assertNoSkippedDocs,
	BulkReturnPoolLockTimeoutError,
	BulkReturnPoolStateError,
	DistributionDataIntegrityError,
	WorkflowValidationError
} from './errors';

export interface BulkReturnPoolV3WorkflowDependencies {
	poolRepo?: BulkReturnPoolV3Repository;
	eventRepo?: BulkReturnEventRepository;
	logRepo?: DistributionLogRepository;
	catalogRepo?: CanonicalUnitCatalogRepository;
	/** Receive only: ledger writer (default: the shelter's operations repository). */
	operationsRepo?: OperationsRepository;
	endpointStore?: { active: string; isWritable: boolean };
	/** Fence wait clock (tests inject a virtual one); default: real time + setTimeout. */
	fenceClock?: FenceClock;
}

interface ResolvedDependencies {
	poolRepo: BulkReturnPoolV3Repository;
	eventRepo: BulkReturnEventRepository;
	logRepo: DistributionLogRepository;
	catalogRepo: CanonicalUnitCatalogRepository;
	endpointStore: { active: string; isWritable: boolean };
	fenceClock: FenceClock;
}

export function resolveDependencies(
	deps: BulkReturnPoolV3WorkflowDependencies | undefined,
	ctx: AuthorContext
): ResolvedDependencies {
	return {
		poolRepo: deps?.poolRepo ?? new BulkReturnPoolV3RemoteRepository(ctx.shelterCode),
		eventRepo: deps?.eventRepo ?? new BulkReturnEventRemoteRepository(ctx.shelterCode),
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		catalogRepo: deps?.catalogRepo ?? catalogRepository(),
		endpointStore:
			deps?.endpointStore ??
			(typeof endpointStore !== 'undefined'
				? { active: endpointStore.active, isWritable: endpointStore.status === 'connected' }
				: { active: 'central', isWritable: true }),
		fenceClock: deps?.fenceClock ?? realFenceClock
	};
}

export interface BulkReturnLoanSkipped {
	distribution_log_id: string;
	qty: string;
	reason: BulkReturnLoanDriftReason;
	/** Outstanding on the loan when skipped (absent for a missing loan). */
	outstanding?: string;
}

export type LoanLike = DistributionLog;

export function assertOperationUlid(operationUlid: string): void {
	if (!isUlid(operationUlid)) {
		throw new WorkflowValidationError(`operationUlid must be a ULID: ${operationUlid}`);
	}
}

export async function requirePool(poolRepo: BulkReturnPoolV3Repository, poolId: string) {
	const pool = await poolRepo.get(poolId);
	if (!pool) {
		throw new BulkReturnPoolStateError(`Bulk return pool ${poolId} was not found`, 'not_found');
	}
	return pool;
}

// ---------------------------------------------------------------------------------------------
// Fence: decide an entry's fate from the pool's FINAL state, not a transient lock
// ---------------------------------------------------------------------------------------------

/** Total time the fence waits for a submit / cancel lock to clear before giving up. */
export const POOL_FENCE_SETTLE_TIMEOUT_MS = 8_000;
/** Re-read delays while the pool is locked (the last one repeats until the timeout). */
export const POOL_FENCE_BACKOFF_MS: readonly number[] = [50, 100, 200, 400, 800, 1_000];

export interface FenceClock {
	now(): number;
	sleep(ms: number): Promise<void>;
}

const realFenceClock: FenceClock = {
	now: () => Date.now(),
	sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
};

/**
 * - `open`: the pool is OPEN and unlocked — apply the entry's loans.
 * - `in_snapshot`: the pool closed (submitted) and its snapshot counted this entry — apply the
 *   loans too (the entry is not late), but write nothing more into this pool.
 * - `late`: the pool closed without counting this entry (or is gone) — leave the loans; the entry
 *   is applied when it is moved into an OPEN pool.
 */
export type PoolFenceOutcome = 'open' | 'in_snapshot' | 'late';

/**
 * Re-reads the pool after an entry landed in it (add or move). A lock means a submit / cancel is
 * mid-flight and may or may not count the entry in its snapshot, so the fence waits (bounded
 * backoff) for the lock to clear and decides from the final state. Throws
 * `BulkReturnPoolLockTimeoutError` when the lock outlives `POOL_FENCE_SETTLE_TIMEOUT_MS`.
 */
export async function settlePoolFence(
	poolRepo: BulkReturnPoolV3Repository,
	poolId: string,
	entryId: string,
	clock: FenceClock = realFenceClock
): Promise<PoolFenceOutcome> {
	const deadline = clock.now() + POOL_FENCE_SETTLE_TIMEOUT_MS;
	for (let attempt = 0; ; attempt++) {
		const pool = await poolRepo.get(poolId);
		if (!pool) return 'late';
		if (!pool.lock) {
			if (pool.status === 'OPEN') return 'open';
			return (pool.entry_ids ?? []).includes(entryId) ? 'in_snapshot' : 'late';
		}
		if (clock.now() >= deadline) {
			throw new BulkReturnPoolLockTimeoutError(
				`Bulk return pool ${poolId} is still locked for ${pool.lock.op} after ${POOL_FENCE_SETTLE_TIMEOUT_MS}ms; retry with the same operationUlid`
			);
		}
		const delay = POOL_FENCE_BACKOFF_MS[Math.min(attempt, POOL_FENCE_BACKOFF_MS.length - 1)];
		await clock.sleep(Math.min(delay, Math.max(0, deadline - clock.now())));
	}
}

export function isOurLock(
	pool: Pick<BulkReturnPoolV3, 'lock'>,
	op: 'SUBMIT' | 'CANCEL',
	operationUlid: string
): boolean {
	return pool.lock?.op === op && pool.lock.op_id === operationUlid;
}

/** Outstanding returnable loans of `returnerId` across all items, oldest first. */
export function outstandingLoansOf(loans: readonly LoanLike[], returnerId: string): LoanLike[] {
	const itemIds = [...new Set(loans.map((loan) => loan.item_id))];
	return itemIds
		.flatMap((itemId) => selectOutstandingLoans(loans, { returnerId, itemId }))
		.sort((a, b) =>
			a.distributed_at !== b.distributed_at
				? a.distributed_at < b.distributed_at
					? -1
					: 1
				: a._id < b._id
					? -1
					: a._id > b._id
						? 1
						: 0
		);
}

/** Applies one ref; returns why it was skipped, or null when applied (or already applied). */
export async function applyRefToLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<BulkReturnLoanSkipped | null> {
	return (await applyRefToLoanDetailed(logRepo, entry, ref, ctx)).skipped;
}

/**
 * Like applyRefToLoan, but also reports whether this call newly wrote the apply and whether the
 * entry was found voided (then nothing is written: `skipped` is null and `written` false).
 *
 * `isEntryVoided` is awaited on every CAS attempt, after the loan was read and before the write is
 * computed, so a void that lands between two attempts is seen by the retry. A void document written
 * after that read but before the loan PUT is not seen: the void's own revert then finds nothing
 * applied yet and the cut survives; that window is a single read-to-PUT round trip.
 */
export async function applyRefToLoanDetailed(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext,
	isEntryVoided?: () => Promise<boolean>
): Promise<{ skipped: BulkReturnLoanSkipped | null; written: boolean; voided: boolean }> {
	let skipped = null as BulkReturnLoanSkipped | null;
	let written = false;
	let voided = false;
	try {
		await logRepo.mutateLogCAS(
			ref.distribution_log_id,
			(current) => {
				skipped = null; // the mutator may run again on a CAS retry
				written = false;
				if (voided) return current;
				const assessment = assessBulkReturnRefOnLoan(current, ref, entry._id);
				if (assessment.status === 'already_applied') return current;
				if (assessment.status === 'skip') {
					skipped = {
						distribution_log_id: ref.distribution_log_id,
						qty: ref.qty,
						reason: assessment.reason,
						...(assessment.outstanding !== undefined ? { outstanding: assessment.outstanding } : {})
					};
					return current; // same reference: the repository writes nothing
				}
				written = true;
				return applyBulkEntryToLog(
					current,
					{ entry_id: entry._id, qty: ref.qty },
					ctx.createdBy,
					now()
				);
			},
			isEntryVoided
				? {
						beforeWrite: async () => {
							voided = await isEntryVoided();
						}
					}
				: undefined
		);
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		return {
			skipped: { distribution_log_id: ref.distribution_log_id, qty: ref.qty, reason: 'missing' },
			written: false,
			voided: false
		};
	}
	return { skipped, written, voided };
}

export async function revertRefOnLoan(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<boolean> {
	let reverted = false;
	try {
		// No-op (same reference, no write) when the entry id is not in applied_bulk_entry_ids, which
		// is the case for a ref that was skipped by loan drift or already reverted.
		await logRepo.mutateLogCAS(ref.distribution_log_id, (current) => {
			// CAS may retry the mutator: decide from the loan this run saw.
			reverted = (current.applied_bulk_entry_ids ?? []).includes(entry._id);
			return revertBulkEntryFromLog(
				current,
				{ entry_id: entry._id, qty: ref.qty },
				ctx.createdBy,
				now()
			);
		});
	} catch (err) {
		// A missing loan can hold no applied entry: nothing to revert (never wedge the void).
		if (!(err instanceof NotFoundError)) throw err;
		return false;
	}
	return reverted;
}

/**
 * Apply-side half of the reopen race (CR-193 §35). Call AFTER the apply CAS writes of `entry`:
 * re-reads the entry's loan reopen doc and, if one exists, reverts every ref in `appliedRefs` (the
 * refs THIS call wrote) with the idempotent `revertRefOnLoan`. Returns true when it reopened.
 * Together with the reopen's final sweep, every apply CAS is either before that sweep (reverted
 * there) or followed by this re-read, which then sees the doc (the reopen writes it before its
 * sweep), so a reopened loan is never left cut.
 */
export async function revertAppliedRefsIfReopened(
	eventRepo: BulkReturnEventRepository,
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	appliedRefs: readonly BulkReturnEntryLoanRef[],
	ctx: AuthorContext
): Promise<boolean> {
	if (!(await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id)))) return false;
	for (const ref of appliedRefs) await revertRefOnLoan(logRepo, entry, ref, ctx);
	return true;
}

/**
 * An entry whose move chain has a gap is omitted from the resolved fold, so its current pool is
 * unknowable: writing a move/void now would target the wrong pool or seq. Reject until it syncs.
 */
export function assertEntryNotPendingSync(
	entry: BulkReturnEntry,
	moves: readonly BulkReturnEntryMove[]
) {
	const fold = foldEntryMoves(
		entry,
		moves.filter((m) => m.entry_id === entry._id)
	);
	if (fold.status === 'pending') {
		throw new WorkflowValidationError(
			`Entry ${entry._id} is pending sync (move seq ${fold.missing_seqs.join(', ')} not replicated yet); try again later`
		);
	}
}

/**
 * Unique pool ids the events reference: entry.pool_id, move from/to and void pool_id. `ownPoolId`
 * is removed when given.
 */
export function referencedPoolIds(
	events: {
		entries: readonly Pick<BulkReturnEntry, 'pool_id'>[];
		moves: readonly Pick<BulkReturnEntryMove, 'from_pool_id' | 'to_pool_id'>[];
		voids: readonly { pool_id: string }[];
	},
	ownPoolId?: string
): string[] {
	const poolIds = new Set<string>([
		...events.entries.map((e) => e.pool_id),
		...events.moves.flatMap((m) => [m.from_pool_id, m.to_pool_id]),
		...events.voids.map((v) => v.pool_id)
	]);
	if (ownPoolId !== undefined) poolIds.delete(ownPoolId);
	return [...poolIds];
}

/**
 * Snapshot pins (entry id -> closed pool that counted it) for the pools the events reference:
 * entry.pool_id, move from/to and void pool_id. `ownPoolId` is left out when the caller already
 * knows it is OPEN (an OPEN pool pins nothing); omit it to include that pool too.
 */
export async function loadSnapshotPins(
	poolRepo: BulkReturnPoolV3Repository,
	events: {
		entries: readonly Pick<BulkReturnEntry, 'pool_id'>[];
		moves: readonly Pick<BulkReturnEntryMove, 'from_pool_id' | 'to_pool_id'>[];
		voids: readonly { pool_id: string }[];
	},
	ownPoolId?: string
): Promise<Map<string, string>> {
	// Scoped reads (CR-193 §18): only the pools the events name, never a whole-shelter list.
	const ids = referencedPoolIds(events, ownPoolId);
	const pools = await Promise.all(ids.map((id) => poolRepo.get(id)));
	return buildSnapshotPins(pools.filter((p): p is BulkReturnPoolV3 => p !== null));
}

/**
 * Write-path variant of `loadSnapshotPins`: fails closed (CR-193 §19) when a referenced pool is
 * unreadable (no doc, or not a v3 pool such as a legacy v1/v2 doc). Its pin would be lost and the
 * write would proceed as if the entry were unpinned.
 */
export async function loadSnapshotPinsForWrite(
	poolRepo: BulkReturnPoolV3Repository,
	events: {
		entries: readonly Pick<BulkReturnEntry, 'pool_id'>[];
		moves: readonly Pick<BulkReturnEntryMove, 'from_pool_id' | 'to_pool_id'>[];
		voids: readonly { pool_id: string }[];
	},
	ownPoolId?: string
): Promise<Map<string, string>> {
	const ids = referencedPoolIds(events, ownPoolId);
	const pools = await Promise.all(ids.map((id) => poolRepo.get(id)));
	return snapshotPinsFromReadPools(ids, pools);
}

/**
 * Builds the pins from pools that were already read (`pools[i]` is the read of `ids[i]`), with the
 * same fail-closed rule as `loadSnapshotPinsForWrite`: any null read throws
 * `DistributionDataIntegrityError` naming those ids.
 */
export function snapshotPinsFromReadPools(
	ids: readonly string[],
	pools: readonly (BulkReturnPoolV3 | null)[]
): Map<string, string> {
	const unreadable = ids.filter((_, i) => pools[i] === null);
	if (unreadable.length > 0) {
		throw new DistributionDataIntegrityError(unreadable, 'referenced bulk return pool unreadable');
	}
	return buildSnapshotPins(pools.filter((p): p is BulkReturnPoolV3 => p !== null));
}

/** Non-voided entries currently in `poolId` plus the freshly fetched loans their refs point at. */
export async function loadLivePoolEntriesWithLoans(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<{ live: BulkReturnEntry[]; loansById: Map<string, DistributionLog | null> }> {
	const { poolRepo, eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const events = await eventRepo.listForPool(poolId);
	// Fail closed: a skipped void/move/entry would make an entry look live, un-voided or gappy.
	assertNoSkippedDocs(events.skipped, `bulk return pool ${poolId}`);
	const pins = await loadSnapshotPins(poolRepo, events);
	const live = resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins)
		.filter(({ pool_id, voided }) => !voided && pool_id === poolId)
		.map(({ entry }) => entry);
	const loanIds = [
		...new Set(live.flatMap((entry) => entry.loan_refs.map((ref) => ref.distribution_log_id)))
	];
	if (loanIds.length === 0) return { live, loansById: new Map() };
	const loans = await Promise.all(loanIds.map((id) => logRepo.get(id)));
	return { live, loansById: new Map(loanIds.map((id, i) => [id, loans[i]])) };
}
