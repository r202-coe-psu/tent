import type { AuthorContext } from '$lib/db/model';
import { ConflictError } from '$lib/utils/errors';
import type { BulkReturnEntryVoid } from '../../domain/food-supplies';
import {
	canVoidEntry,
	createBulkReturnEntryVoid,
	deriveEntryVoidId,
	resolveBulkReturnEntries
} from '../../domain/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import { assertNoSkippedDocs, BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	assertEntryNotPendingSync,
	loadSnapshotPins,
	requirePool,
	resolveDependencies,
	revertRefOnLoan,
	settlePoolFence,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// 5. void
// ---------------------------------------------------------------------------------------------

export interface VoidBulkReturnEntryInput {
	entry_id: string;
	notes?: string;
}

export interface VoidBulkReturnEntryResult {
	entryVoid: BulkReturnEntryVoid;
	replayed: boolean;
	/**
	 * Ids of loans actually reverted by this call (a ref never applied, or already reverted by an
	 * earlier call/replay, is not listed).
	 */
	loansReverted: string[];
	/**
	 * The void was written after the pool's submit snapshot counted the entry (a submit raced the
	 * void). It has no effect: the entry stays counted in the submitted pool and no loan is
	 * reverted; staff must reconcile it (the pool overview lists it as a snapshot conflict).
	 */
	snapshot_conflict: boolean;
}

/** Voids an entry (only while its pool is OPEN and unlocked) and reopens the loans it closed. */
export async function voidBulkReturnEntry(
	input: VoidBulkReturnEntryInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<VoidBulkReturnEntryResult> {
	const {
		poolRepo,
		eventRepo,
		logRepo,
		endpointStore: epStore,
		fenceClock
	} = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	const events = await eventRepo.listForEntry(input.entry_id);
	// Fail closed: a skipped doc of this entry's chain would look like a gap or a missing void.
	assertNoSkippedDocs(events.skipped, `bulk return entry ${input.entry_id}`);
	const entry = events.entries.find((e) => e._id === input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);

	const revertLoans = async (): Promise<string[]> => {
		const reverted: string[] = [];
		for (const ref of entry.loan_refs) {
			if (await revertRefOnLoan(logRepo, entry, ref, ctx)) {
				reverted.push(ref.distribution_log_id);
			}
		}
		return reverted;
	};

	// Decide from the void's pool FINAL state (waits out a submit lock): a snapshot that counted
	// the entry makes this void a conflict with no loan effect, otherwise reopen the loans.
	const finish = async (entryVoid: BulkReturnEntryVoid, replayed: boolean, voidPoolId: string) => {
		const fence = await settlePoolFence(poolRepo, voidPoolId, entry._id, fenceClock);
		if (fence === 'in_snapshot') {
			return { entryVoid, replayed, loansReverted: [], snapshot_conflict: true };
		}
		return { entryVoid, replayed, loansReverted: await revertLoans(), snapshot_conflict: false };
	};

	const existingVoid = await eventRepo.getVoid(deriveEntryVoidId(entry._id));
	if (existingVoid) return finish(existingVoid, true, existingVoid.pool_id);
	assertEntryNotPendingSync(entry, events.moves);

	const pins = await loadSnapshotPins(poolRepo, events);
	const resolved = resolveBulkReturnEntries(events.entries, events.moves, events.voids, pins).find(
		(r) => r.entry._id === entry._id
	);
	const poolId = resolved?.pool_id ?? entry.pool_id;
	const pool = await requirePool(poolRepo, poolId);
	if (!canVoidEntry(pool)) {
		throw new BulkReturnPoolStateError(
			`Entry ${entry._id} cannot be voided: pool ${pool._id} is not OPEN and unlocked`,
			pool.status === 'OPEN' ? 'locked' : 'closed'
		);
	}

	const doc = createBulkReturnEntryVoid(
		{ entry, pool_id: poolId, ...(input.notes ? { notes: input.notes } : {}) },
		ctx
	);
	let entryVoid: BulkReturnEntryVoid;
	let replayed = false;
	try {
		entryVoid = await eventRepo.createVoid(doc);
	} catch (err) {
		if (!(err instanceof ConflictError)) throw err;
		const winner = await eventRepo.getVoid(doc._id);
		if (!winner) throw err;
		entryVoid = winner;
		replayed = true;
	}

	return finish(entryVoid, replayed, poolId);
}
