import type { AuthorContext } from '$lib/db/model';
import type {
	BulkReturnEntry,
	DistributionLog,
	MissedBulkReturnLoanRef
} from '../../domain/food-supplies';
import { findMissedLoanRefs } from '../../domain/food-supplies';
import { assertCanWriteBulkReturnEntry } from './auth';
import { assertCentralWriteAuthority } from './central-write-authority';
import { BulkReturnPoolStateError, WorkflowValidationError } from './errors';
import {
	applyRefToLoanDetailed,
	requirePool,
	resolveDependencies,
	type BulkReturnLoanSkipped,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// Repair: refs of an entry in a closed pool whose loans were never cut (fence lock timeout)
// ---------------------------------------------------------------------------------------------

/**
 * Refs of the entries in a closed (SUBMITTED / RECEIVED) pool's snapshot (`entry_ids`) that were
 * planned but never applied although the loan can still take them. An OPEN pool returns `[]`: an
 * unapplied ref there may just be an add in flight. Voids / moves are ignored on purpose: an entry
 * in a closed pool's `entry_ids` stays counted there. Derived at read time, nothing is persisted.
 */
export async function listBulkReturnPoolMissedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<MissedBulkReturnLoanRef[]> {
	const { poolRepo, eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const pool = await requirePool(poolRepo, poolId);
	if (pool.status === 'OPEN') return [];

	// getEntry validates the doc and throws on a malformed one: the read fails closed.
	const found = await Promise.all((pool.entry_ids ?? []).map((id) => eventRepo.getEntry(id)));
	const entries = found.filter((e): e is BulkReturnEntry => e !== null);
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
}

/**
 * Applies the planned loan refs of ONE entry of a SUBMITTED / RECEIVED pool whose add never cut
 * its loans. Never re-allocates: only the entry's stored `loan_refs`. Idempotent via
 * `applied_bulk_entry_ids`; a drifted loan is skipped (CR-193 §15), never partially applied.
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
	if (pool.status !== 'SUBMITTED' && pool.status !== 'RECEIVED') {
		throw new BulkReturnPoolStateError(
			pool.status === 'OPEN'
				? `Bulk return pool ${pool._id} is still OPEN: its loans are applied when entries are added`
				: `Bulk return pool ${pool._id} is ${pool.status}: nothing to apply`,
			pool.status === 'OPEN' ? 'not_submitted' : 'closed'
		);
	}
	if (!(pool.entry_ids ?? []).includes(input.entry_id)) {
		throw new WorkflowValidationError(
			`Entry ${input.entry_id} is not part of the ${pool._id} snapshot`
		);
	}
	const entry = await eventRepo.getEntry(input.entry_id);
	if (!entry) throw new WorkflowValidationError(`bulk_return_entry ${input.entry_id} not found`);

	const loansApplied: string[] = [];
	const loansSkipped: BulkReturnLoanSkipped[] = [];
	for (const ref of entry.loan_refs) {
		const { skipped, written } = await applyRefToLoanDetailed(logRepo, entry, ref, ctx);
		if (skipped) loansSkipped.push(skipped);
		else if (written) loansApplied.push(ref.distribution_log_id);
	}
	return { loansApplied, loansSkipped };
}
