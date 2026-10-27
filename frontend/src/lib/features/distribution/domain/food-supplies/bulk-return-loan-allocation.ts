import { qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import type { BulkReturnEntryLoanRef } from './bulk-return-entry';
import type { DistributionLog } from './distribution-log';

/**
 * #659 — pure helpers that decide which of a returner's loans a bulk return entry closes (or
 * reduces). The allocation is written into the entry's `loan_refs`; the application workflow then
 * applies each ref to its `distribution_log` with `applyBulkEntryToLog`.
 */

export type AllocatableLoan = Pick<
	DistributionLog,
	| '_id'
	| 'item_id'
	| 'qty'
	| 'qty_returned'
	| 'status'
	| 'is_returnable'
	| 'recipient_id'
	| 'distributed_at'
>;

function outstandingQty(loan: Pick<AllocatableLoan, 'qty' | 'qty_returned'>): string {
	return subQty(loan.qty, loan.qty_returned ?? '0');
}

function byOldestFirst(a: AllocatableLoan, b: AllocatableLoan): number {
	if (a.distributed_at !== b.distributed_at) return a.distributed_at < b.distributed_at ? -1 : 1;
	return a._id < b._id ? -1 : a._id > b._id ? 1 : 0;
}

/**
 * Outstanding returnable loans of `returnerId` for `itemId` (status active | partially_returned
 * with something left to return), oldest first (distributed_at asc, then _id).
 */
export function selectOutstandingLoans<L extends AllocatableLoan>(
	loans: readonly L[],
	criteria: { returnerId: string; itemId: string }
): L[] {
	return loans
		.filter(
			(loan) =>
				loan.is_returnable &&
				(loan.status === 'active' || loan.status === 'partially_returned') &&
				loan.recipient_id === criteria.returnerId &&
				loan.item_id === criteria.itemId &&
				qtyGt(outstandingQty(loan), 0)
		)
		.sort(byOldestFirst);
}

/**
 * Allocates `qty` across `loans` oldest-first (distributed_at asc, then _id), at most each loan's
 * outstanding (qty - qty_returned). Loans with nothing outstanding are skipped. Quantity beyond
 * the total outstanding is NOT allocated (it goes into the pool without a loan ref), so the sum of
 * the result is <= `qty`.
 */
export function allocateBulkReturnToLoans(
	loans: readonly AllocatableLoan[],
	qty: string
): BulkReturnEntryLoanRef[] {
	const refs: BulkReturnEntryLoanRef[] = [];
	let remaining = qty;
	for (const loan of [...loans].sort(byOldestFirst)) {
		if (!qtyGt(remaining, 0)) break;
		const outstanding = outstandingQty(loan);
		if (!qtyGt(outstanding, 0)) continue;
		const take = qtyLte(remaining, outstanding) ? remaining : outstanding;
		refs.push({ distribution_log_id: loan._id, qty: take });
		remaining = subQty(remaining, take);
	}
	return refs;
}
