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
import { BulkReturnPoolStateError, WorkflowValidationError } from './errors';

export interface BulkReturnPoolV3WorkflowDependencies {
	poolRepo?: BulkReturnPoolV3Repository;
	eventRepo?: BulkReturnEventRepository;
	logRepo?: DistributionLogRepository;
	catalogRepo?: CanonicalUnitCatalogRepository;
	/** Receive only: ledger writer (default: the shelter's operations repository). */
	operationsRepo?: OperationsRepository;
	endpointStore?: { active: string; isWritable: boolean };
}

interface ResolvedDependencies {
	poolRepo: BulkReturnPoolV3Repository;
	eventRepo: BulkReturnEventRepository;
	logRepo: DistributionLogRepository;
	catalogRepo: CanonicalUnitCatalogRepository;
	endpointStore: { active: string; isWritable: boolean };
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
				: { active: 'central', isWritable: true })
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
	if (!pool) throw new BulkReturnPoolStateError(`Bulk return pool ${poolId} was not found`);
	return pool;
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

/** Like applyRefToLoan, but also reports whether this call newly wrote the apply. */
export async function applyRefToLoanDetailed(
	logRepo: DistributionLogRepository,
	entry: BulkReturnEntry,
	ref: BulkReturnEntryLoanRef,
	ctx: AuthorContext
): Promise<{ skipped: BulkReturnLoanSkipped | null; written: boolean }> {
	let skipped = null as BulkReturnLoanSkipped | null;
	let written = false;
	try {
		await logRepo.mutateLogCAS(ref.distribution_log_id, (current) => {
			skipped = null; // the mutator may run again on a CAS retry
			written = false;
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
		});
	} catch (err) {
		if (!(err instanceof NotFoundError)) throw err;
		return {
			skipped: { distribution_log_id: ref.distribution_log_id, qty: ref.qty, reason: 'missing' },
			written: false
		};
	}
	return { skipped, written };
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

/** Non-voided entries currently in `poolId` plus the freshly fetched loans their refs point at. */
export async function loadLivePoolEntriesWithLoans(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<{ live: BulkReturnEntry[]; loansById: Map<string, DistributionLog | null> }> {
	const { eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const events = await eventRepo.listForPool(poolId);
	const live = resolveBulkReturnEntries(events.entries, events.moves, events.voids)
		.filter(({ pool_id, voided }) => !voided && pool_id === poolId)
		.map(({ entry }) => entry);
	const loanIds = [
		...new Set(live.flatMap((entry) => entry.loan_refs.map((ref) => ref.distribution_log_id)))
	];
	if (loanIds.length === 0) return { live, loansById: new Map() };
	const loans = await Promise.all(loanIds.map((id) => logRepo.get(id)));
	return { live, loansById: new Map(loanIds.map((id, i) => [id, loans[i]])) };
}
