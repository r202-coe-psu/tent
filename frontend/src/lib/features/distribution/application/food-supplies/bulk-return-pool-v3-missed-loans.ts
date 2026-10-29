import type { AuthorContext } from '$lib/db/model';
import type {
	BulkReturnEntryLoanRef,
	DistributionLog,
	MissedBulkReturnLoanRef
} from '../../domain/food-supplies';
import {
	deriveEntryVoidId,
	deriveLoanReopenId,
	findMissedLoanRefs,
	resolveBulkReturnEntries
} from '../../domain/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import { assertNoSkippedDocs, BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	applyRefToLoanDetailed,
	loadLivePoolEntriesWithLoans,
	loadSnapshotPinsForWrite,
	requirePool,
	resolveDependencies,
	revertAppliedRefsIfReopened,
	type BulkReturnLoanSkipped,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// Repair: refs of an entry in a closed pool whose loans were never cut (fence lock timeout)
// ---------------------------------------------------------------------------------------------

/**
 * Refs that were planned but never applied although the loan can still take them.
 * - Closed (SUBMITTED / RECEIVED) pool: the entries of its snapshot (`entry_ids`). Voids / moves
 *   are ignored on purpose: an entry in a closed pool's `entry_ids` stays counted there.
 * - OPEN pool: the LIVE entries, i.e. not voided and currently resolving to this pool. An OPEN pool
 *   that currently holds a lock (SUBMIT / CANCEL in flight) returns [] (§37.3). A ref listed for a pool whose add is still in flight is applied by that add; the apply is
 *   idempotent, so a repair racing it never cuts a loan twice.
 * Derived at read time, nothing is persisted.
 */
export async function listBulkReturnPoolMissedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<MissedBulkReturnLoanRef[]> {
	const { poolRepo, eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const pool = await requirePool(poolRepo, poolId);
	if (pool.status === 'OPEN') {
		// CR-193 §37.3: a pool locked for SUBMIT / CANCEL waits for that to finish first; the apply
		// path rejects it as 'locked', so offering its refs would only lead to a rejected click.
		if (pool.lock) return [];
		const { live, loansById } = await loadLivePoolEntriesWithLoans(poolId, ctx, deps);
		return findMissedLoanRefs(live, loansById);
	}

	// Batched reads; getEntriesByIds validates every doc and throws on a malformed one: fails closed.
	const present = await eventRepo.getEntriesByIds(pool.entry_ids ?? []);
	// CR-193 §35: an entry whose loans were reopened on purpose must never be offered for a re-cut.
	const reopens = await eventRepo.getLoanReopensByIds(
		present.map((e) => deriveLoanReopenId(e._id))
	);
	const reopenedIds = new Set(reopens.map((r) => r._id));
	const entries = present.filter((e) => !reopenedIds.has(deriveLoanReopenId(e._id)));
	const loanIds = [
		...new Set(entries.flatMap((e) => e.loan_refs.map((ref) => ref.distribution_log_id)))
	];
	if (loanIds.length === 0) return [];
	const { items } = await logRepo.getMany(loanIds);
	const byId = new Map<string, DistributionLog | null>(items.map((loan) => [loan._id, loan]));
	const loansById = new Map<string, DistributionLog | null>(
		loanIds.map((id) => [id, byId.get(id) ?? null])
	);
	return findMissedLoanRefs(entries, loansById);
}

export interface ApplyMissedBulkReturnLoanRefsInput {
	entry_id: string;
	pool_id: string;
}

export interface ApplyMissedBulkReturnLoanRefsResult {
	/** Loans newly cut by this call (distribution_log ids; already-applied refs are silent no-ops). */
	loansApplied: string[];
	/** Refs not applied (loan closed / missing / insufficient). */
	loansSkipped: BulkReturnLoanSkipped[];
	/** The entry was voided (OPEN pool only): no loan was touched. */
	voided?: true;
}

/**
 * Applies the planned loan refs of ONE entry whose add never cut its loans. Never re-allocates:
 * only the entry's stored `loan_refs`. Idempotent via `applied_bulk_entry_ids`; a drifted loan is
 * skipped (CR-193 §15), never partially applied.
 * - SUBMITTED / RECEIVED pool: the entry must be in the pool's snapshot (`entry_ids`).
 * - OPEN pool: the entry must be live there (not voided, currently resolving to this pool) and the
 *   void is re-read inside every loan CAS attempt. A pool locked for SUBMIT / CANCEL is rejected
 *   with reason 'locked' so the repair never races the snapshot.
 * - CANCELLED pool: rejected.
 */
export async function applyMissedBulkReturnLoanRefs(
	input: ApplyMissedBulkReturnLoanRefsInput,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ApplyMissedBulkReturnLoanRefsResult> {
	const { poolRepo, eventRepo, logRepo, endpointStore: epStore } = resolveDependencies(deps, ctx);
	assertCentralWriteAuthority(epStore);
	assertCanWriteBulkReturnEntry(ctx);

	const pool = await requirePool(poolRepo, input.pool_id);
	const isOpen = pool.status === 'OPEN';
	if (!isOpen && pool.status !== 'SUBMITTED' && pool.status !== 'RECEIVED') {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${pool._id} is ${pool.status}: nothing to apply`,
			'closed'
		);
	}
	if (isOpen && pool.lock) {
		throw new BulkReturnPoolStateError(
			`Bulk return pool ${pool._id} is locked for ${pool.lock.op}: try again when it clears`,
			'locked'
		);
	}
	if (!isOpen && !(pool.entry_ids ?? []).includes(input.entry_id)) {
		throw new WorkflowValidationError(
			`Entry ${input.entry_id} is not part of the ${pool._id} snapshot`
		);
	}
	if (isOpen) {
		const events = await eventRepo.listForEntry(input.entry_id);
		assertNoSkippedDocs(events.skipped, `bulk return entry ${input.entry_id}`);
		const pins = await loadSnapshotPinsForWrite(poolRepo, events);
		const resolved = resolveBulkReturnEntries(
			events.entries,
			events.moves,
			events.voids,
			pins
		).find((r) => r.entry._id === input.entry_id);
		if (!resolved || resolved.voided || resolved.pool_id !== pool._id) {
			throw new WorkflowValidationError(`Entry ${input.entry_id} is not live in ${pool._id}`);
		}
	}
	const entry = await eventRepo.getEntry(input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);
	const reopenedError = () =>
		new WorkflowValidationError(
			`Entry ${entry._id} had its loans reopened on purpose: they are not re-applied`
		);
	if (await eventRepo.getLoanReopen(deriveLoanReopenId(entry._id))) throw reopenedError();

	const voidId = deriveEntryVoidId(entry._id);
	const isEntryVoided = isOpen ? async () => (await eventRepo.getVoid(voidId)) !== null : undefined;
	const loansApplied: string[] = [];
	const writtenRefs: BulkReturnEntryLoanRef[] = [];
	const loansSkipped: BulkReturnLoanSkipped[] = [];
	let voided = false;
	for (const ref of entry.loan_refs) {
		const outcome = await applyRefToLoanDetailed(logRepo, entry, ref, ctx, isEntryVoided);
		if (outcome.voided) voided = true;
		else if (outcome.skipped) loansSkipped.push(outcome.skipped);
		else if (outcome.written) {
			loansApplied.push(ref.distribution_log_id);
			writtenRefs.push(ref);
		}
	}
	// A manager may have reopened between the pre-check and the CAS writes above: undo what this
	// call wrote so the loan is not cut again behind the reopen (same outcome as an earlier reopen).
	if (
		writtenRefs.length > 0 &&
		(await revertAppliedRefsIfReopened(eventRepo, logRepo, entry, writtenRefs, ctx))
	) {
		throw reopenedError();
	}
	return { loansApplied, loansSkipped, ...(voided ? { voided: true as const } : {}) };
}
