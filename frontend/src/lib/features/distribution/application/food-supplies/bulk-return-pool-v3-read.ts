import type { AuthorContext } from '$lib/db/model';
import type {
	AppliedBulkReturnLoanRef,
	BulkReturnPoolOverviewRow,
	ClosedBulkReturnLoanRef,
	DistributionLog
} from '../../domain/food-supplies';
import {
	buildBulkReturnPoolOverview,
	findAppliedBulkReturnLoanRefs,
	findClosedBulkReturnLoanRefs
} from '../../domain/food-supplies';
import { WorkflowValidationError } from './errors';
import {
	loadLivePoolEntriesWithLoans,
	outstandingLoansOf,
	resolveDependencies,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-shared';

// ---------------------------------------------------------------------------------------------
// 7. reads
// ---------------------------------------------------------------------------------------------

export interface BulkReturnPoolOverviewQuery {
	includeCancelled?: boolean;
}

/** Pool list read model: per-pool entries, per-item totals, late entries, emptiness. */
export async function getBulkReturnPoolOverview(
	options: BulkReturnPoolOverviewQuery,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<BulkReturnPoolOverviewRow[]> {
	const { poolRepo, eventRepo } = resolveDependencies(deps, ctx);
	const [pools, events] = await Promise.all([poolRepo.list(), eventRepo.listAll()]);
	return buildBulkReturnPoolOverview(pools, events, { includeCancelled: options.includeCancelled });
}

/**
 * Loan-drift warning source: refs of the non-voided entries currently in `poolId` that are not
 * applied to their loan and cannot be applied now (closed / insufficient / missing). Derived from
 * the fresh loans on every read; nothing is persisted.
 */
export async function listBulkReturnPoolClosedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<ClosedBulkReturnLoanRef[]> {
	const { live, loansById } = await loadLivePoolEntriesWithLoans(poolId, ctx, deps);
	return findClosedBulkReturnLoanRefs(live, loansById);
}

/**
 * Refs of the non-voided entries currently in `poolId` that are actually applied on their loan
 * (the entry id is in the loan's `applied_bulk_entry_ids`). Derived from fresh loans on every read.
 */
export async function listBulkReturnPoolAppliedLoanRefs(
	poolId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<AppliedBulkReturnLoanRef[]> {
	const { live, loansById } = await loadLivePoolEntriesWithLoans(poolId, ctx, deps);
	return findAppliedBulkReturnLoanRefs(live, loansById);
}

/** Outstanding returnable loans of a returner (all items), oldest first, so the UI can show/warn. */
export async function listReturnerOutstandingLoans(
	returnerId: string,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<DistributionLog[]> {
	if (!returnerId.startsWith('evacuee:') && !returnerId.startsWith('volunteer:')) {
		throw new WorkflowValidationError('returnerId must start with evacuee: or volunteer:');
	}
	const { logRepo } = resolveDependencies(deps, ctx);
	const loans = await logRepo.list({ recipient_id: returnerId, is_returnable: true });
	return outstandingLoansOf(loans, returnerId);
}
