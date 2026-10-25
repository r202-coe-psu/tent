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
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowValidationError
} from './errors';
import {
	applyRefToLoanDetailed,
	assertEntryNotPendingSync,
	requirePool,
	resolveDependencies,
	type BulkReturnLoanSkipped,
	type BulkReturnPoolV3WorkflowDependencies
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
	ctx: AuthorContext
): Promise<{ late: boolean; loansApplied: string[]; loansSkipped: BulkReturnLoanSkipped[] }> {
	const fresh = await poolRepo.get(toPoolId);
	if (!fresh || !canAppendToPool(fresh)) return { late: true, loansApplied: [], loansSkipped: [] };
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
	const { poolRepo, eventRepo, logRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	// Only this entry's own chain matters: read it alone so another pool's bad doc cannot block it.
	const events = await eventRepo.listForEntry(input.entry_id);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);
	try {
		assertEntryCanBeMoved(entry._id, events.voids);
	} catch (err) {
		throw new WorkflowValidationError(err instanceof Error ? err.message : String(err));
	}
	assertEntryNotPendingSync(entry, events.moves);

	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids).find(
		(r) => r.entry._id === entry._id
	);
	const currentPoolId = resolved?.pool_id ?? entry.pool_id;
	// Replay rule: moves carry no operationUlid, so a retry is recognised when the entry already
	// sits in the target pool AND its latest move (highest seq) went there. An entry created in
	// the target pool (no such move) is "already in target pool" and still rejected.
	if (input.to_pool_id === currentPoolId) {
		const latest = events.moves
			.filter((m) => m.entry_id === entry._id)
			.reduce<BulkReturnEntryMove | undefined>((a, m) => (!a || m.seq > a.seq ? m : a), undefined);
		if (!latest || latest.to_pool_id !== input.to_pool_id) {
			throw new WorkflowValidationError(`Entry ${entry._id} is already in ${input.to_pool_id}`);
		}
		const outcome = await applyEntryLoansAfterMove(logRepo, poolRepo, entry, input.to_pool_id, ctx);
		return { move: latest, replayed: true, ...outcome };
	}

	const target = await requirePool(poolRepo, input.to_pool_id);
	if (!canAppendToPool(target)) {
		throw new BulkReturnPoolStateError(
			`Target bulk return pool ${target._id} is not OPEN and unlocked`
		);
	}
	const source = await requirePool(poolRepo, currentPoolId);
	if (!canAppendToPool(source) && !isLateEntry(entry._id, source)) {
		throw new BulkReturnPoolStateError(
			`Entry ${entry._id} cannot leave ${source._id}: the pool is not OPEN and the entry is not late`
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

	const outcome = await applyEntryLoansAfterMove(logRepo, poolRepo, entry, input.to_pool_id, ctx);
	return { move, replayed, ...outcome };
}
