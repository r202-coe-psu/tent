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
import type { SkippedDoc } from '../../data/food-supplies';
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
	const { poolRepo, eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const [pools, events] = await Promise.all([poolRepo.list(), eventRepo.listAll()]);
	const rows = buildBulkReturnPoolOverview(pools, events, {
		includeCancelled: options.includeCancelled
	});

	// Closed-loan-mid-flight: ONE batched loan read for every live entry of every non-cancelled pool.
	const liveByRow = rows.map((row) =>
		row.pool.status === 'CANCELLED' ? [] : row.entries.filter((r) => !r.voided).map((r) => r.entry)
	);
	const loanIds = [
		...new Set(
			liveByRow.flatMap((live) =>
				live.flatMap((entry) => entry.loan_refs.map((ref) => ref.distribution_log_id))
			)
		)
	];
	if (loanIds.length === 0) return rows;
	// Skipped (malformed) loan docs are left out here, so they count as missing; never throw on read.
	const { items } = await logRepo.getMany(loanIds);
	const found = new Map(items.map((loan) => [loan._id, loan]));
	const loansById = new Map<string, DistributionLog | null>(
		loanIds.map((id) => [id, found.get(id) ?? null])
	);
	return rows.map((row, i) => ({
		...row,
		closed_loan_refs: findClosedBulkReturnLoanRefs(liveByRow[i], loansById)
	}));
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

export interface BulkReturnSkippedDocsQuery {
	/** Also report malformed loans of this returner (the returner outstanding-loans read). */
	returnerId?: string;
}

/**
 * Malformed docs the bulk return reads leave out instead of failing: pool headers, the entry /
 * move / void events (the pool overview) and, with `returnerId`, that returner's loans. Read-only
 * companion to the overview and outstanding-loans reads so the UI can warn about what is missing.
 */
export async function listBulkReturnSkippedDocs(
	query: BulkReturnSkippedDocsQuery,
	ctx: AuthorContext,
	deps?: BulkReturnPoolV3WorkflowDependencies
): Promise<SkippedDoc[]> {
	const { returnerId } = query;
	if (
		returnerId !== undefined &&
		!returnerId.startsWith('evacuee:') &&
		!returnerId.startsWith('volunteer:')
	) {
		throw new WorkflowValidationError('returnerId must start with evacuee: or volunteer:');
	}
	const { poolRepo, eventRepo, logRepo } = resolveDependencies(deps, ctx);
	const [pools, events, loans] = await Promise.all([
		poolRepo.listWithSkipped(),
		eventRepo.listAll(),
		returnerId
			? logRepo.listWithSkipped({ recipient_id: returnerId, is_returnable: true })
			: Promise.resolve({ skipped: [] as SkippedDoc[] })
	]);
	return [...pools.skipped, ...events.skipped, ...loans.skipped];
}
