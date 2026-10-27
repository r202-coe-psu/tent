import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import type { BulkReturnEntry, BulkReturnEntryMove } from '../../domain/food-supplies';
import {
	assertEntryCanBeMoved,
	canAppendToPool,
	createBulkReturnEntryMove,
	deriveEntryMoveId,
	isLateEntry,
	resolveBulkReturnEntries
} from '../../domain/food-supplies';
import type {
	BulkReturnPoolV3Repository,
	DistributionLogRepository
} from '../../data/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import {
	assertNoSkippedDocs,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import {
	applyRefToLoanDetailed,
	assertEntryNotPendingSync,
	loadSnapshotPinsForWrite,
	requirePool,
	resolveDependencies,
	settlePoolFence,
	type BulkReturnLoanSkipped,
	type BulkReturnPoolV3WorkflowDependencies,
	type FenceClock
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// 4. move
// ---------------------------------------------------------------------------------------------

export interface MoveBulkReturnEntryInput {
	entry_id: string;
	to_pool_id: string;
	notes?: string;
}

export interface MoveBulkReturnEntryResult {
	move: BulkReturnEntryMove;
	/** The target pool stopped accepting entries right after the move: move the entry again. */
	late: boolean;
	replayed: boolean;
	/** Loans newly applied by this call (distribution_log ids; excludes already-applied refs). */
	loansApplied: string[];
	/** Refs not applied (loan closed / missing / insufficient); empty when late. */
	loansSkipped: BulkReturnLoanSkipped[];
	/**
	 * The source pool's submit snapshot counted the entry before this move was written (a submit
	 * raced the move). The move has no effect: the entry stays counted in the source pool, the
	 * target does not hold it and no loan is touched; staff must reconcile it.
	 */
	snapshot_conflict: boolean;
}

/**
 * Applies an entry's loan refs once its pool is known to be appendable (move path). `loansApplied`
 * holds only refs newly written by this call; already-applied refs are silent no-ops.
 */
async function applyEntryLoansAfterMove(
	logRepo: DistributionLogRepository,
	poolRepo: BulkReturnPoolV3Repository,
	entry: BulkReturnEntry,
	toPoolId: string,
	ctx: AuthorContext,
	fenceClock: FenceClock
): Promise<{ late: boolean; loansApplied: string[]; loansSkipped: BulkReturnLoanSkipped[] }> {
	// Same fence as add: wait out a submit lock; an entry the snapshot counted is not late.
	const fence = await settlePoolFence(poolRepo, toPoolId, entry._id, fenceClock);
	if (fence === 'late') return { late: true, loansApplied: [], loansSkipped: [] };
	const loansApplied: string[] = [];
	const loansSkipped: BulkReturnLoanSkipped[] = [];
	for (const ref of entry.loan_refs) {
		const { skipped, written } = await applyRefToLoanDetailed(logRepo, entry, ref, ctx);
		if (skipped) loansSkipped.push(skipped);
		else if (written) loansApplied.push(ref.distribution_log_id);
	}
	return { late: false, loansApplied, loansSkipped };
}

/**
 * Moves a whole entry to another OPEN pool. After the move, the target pool is re-read (fence);
 * only if it is still appendable are the entry's loan refs applied (same per-ref rule as add,
 * idempotent via applied_bulk_entry_ids). This is how a late entry (whose loans add never applied)
 * finally clears its loans. A normal, already-applied entry is a no-op on loans.
 */
export async function moveBulkReturnEntry(
	input: MoveBulkReturnEntryInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<MoveBulkReturnEntryResult> {
	const {
		poolRepo,
		eventRepo,
		logRepo,
		endpointStore: epStore,
		fenceClock
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	// Only this entry's own chain matters: read it alone so another pool's bad doc cannot block it.
	const events = await eventRepo.listForEntry(input.entry_id);
	// Fail closed: a skipped doc of this entry's chain would look like a gap or a missing void.
	assertNoSkippedDocs(events.skipped, `bulk return entry ${input.entry_id}`);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);
	try {
		assertEntryCanBeMoved(entry._id, events.voids);
	} catch (err) {
		throw new WorkflowValidationError(err instanceof Error ? err.message : String(err));
	}
	assertEntryNotPendingSync(entry, events.moves);

	const pins = await loadSnapshotPinsForWrite(poolRepo, events);
	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins).find(
		(r) => r.entry._id === entry._id
	);
	const currentPoolId = resolved?.pool_id ?? entry.pool_id;

	/** Source fence + target fence/loans for a move that is written; a snapshot hit stops there. */
	const afterMove = async (
		move: BulkReturnEntryMove,
		replayed: boolean,
		sourcePoolId: string
	): Promise<MoveBulkReturnEntryResult> => {
		// The source may have snapshotted between our check and the write: that snapshot counted the
		// entry, so it stays there (no loan effect, no target fence).
		const sourceFence = await settlePoolFence(poolRepo, sourcePoolId, entry._id, fenceClock);
		if (sourceFence === 'in_snapshot') {
			return {
				move,
				replayed,
				late: false,
				loansApplied: [],
				loansSkipped: [],
				snapshot_conflict: true
			};
		}
		const outcome = await applyEntryLoansAfterMove(
			logRepo,
			poolRepo,
			entry,
			move.to_pool_id,
			ctx,
			fenceClock
		);
		return { move, replayed, ...outcome, snapshot_conflict: false };
	};
	// Replay rule: moves carry no operationUlid, so a retry is recognised when the entry already
	// sits in the target pool AND its latest move (highest seq) went there. An entry created in
	// the target pool (no such move) is "already in target pool" and still rejected.
	const latest = events.moves
		.filter((m) => m.entry_id === entry._id)
		.reduce<BulkReturnEntryMove | undefined>((a, m) => (!a || m.seq > a.seq ? m : a), undefined);
	// A move the snapshot pin neutralised leaves the entry in its snapshot pool, so its retry is
	// recognised by the latest move instead.
	const replayOfConflict =
		resolved?.snapshot_conflict === 'move' && latest?.to_pool_id === input.to_pool_id;
	if (input.to_pool_id === currentPoolId || replayOfConflict) {
		if (!latest || latest.to_pool_id !== input.to_pool_id) {
			throw new WorkflowValidationError(`Entry ${entry._id} is already in ${input.to_pool_id}`);
		}
		return afterMove(latest, true, latest.from_pool_id);
	}

	const target = await requirePool(poolRepo, input.to_pool_id);
	if (!canAppendToPool(target)) {
		throw new BulkReturnPoolStateError(
			`Target bulk return pool ${target._id} is not OPEN and unlocked`,
			target.status === 'OPEN' ? 'locked' : 'closed'
		);
	}
	const source = await requirePool(poolRepo, currentPoolId);
	if (!canAppendToPool(source) && !isLateEntry(entry._id, source)) {
		throw new BulkReturnPoolStateError(
			`Entry ${entry._id} cannot leave ${source._id}: the pool is not OPEN and the entry is not late`,
			source.status === 'OPEN' ? 'locked' : 'source_closed'
		);
	}

	const seq = events.moves.filter((m) => m.entry_id === entry._id).length + 1;
	const doc = createBulkReturnEntryMove(
		{
			entry,
			seq,
			from_pool_id: currentPoolId,
			to_pool_id: input.to_pool_id,
			...(input.notes ? { notes: input.notes } : {})
		},
		ctx
	);

	let move: BulkReturnEntryMove;
	let replayed = false;
	try {
		move = await eventRepo.createMove(doc);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const winner = await eventRepo.getMove(deriveEntryMoveId(entry._id, seq));
		if (!winner) throw err;
		if (winner.to_pool_id !== input.to_pool_id || winner.from_pool_id !== currentPoolId) {
			throw new ConcurrencyCollisionError(
				`Entry ${entry._id} was concurrently moved to ${winner.to_pool_id}`
			);
		}
		move = winner;
		replayed = true;
	}

	return afterMove(move, replayed, currentPoolId);
}
