import { qtyGt, subQty } from '$lib/utils/qty';
import type { BulkReturnEntry } from './bulk-return-entry';
import type { DistributionLog } from './distribution-log';

/**
 * Loan drift: a `bulk_return_entry` allocates its `loan_refs` at write time, but the loan may be
 * closed (lost / waived / returned / voided) or have less outstanding by the time the ref is applied
 * or read. These pure helpers decide, from the CURRENT loan doc, whether a ref can still be applied
 * and why not. Used by the apply step (workflow) and by the read-time warning, so both agree.
 *
 * A ref is all-or-nothing: it is never partially applied. Void reverts `ref.qty`, and without a
 * persisted per-entry applied qty a partial apply would make a later void over-revert.
 */

export type BulkReturnLoanDriftReason = 'closed' | 'insufficient' | 'missing';

export type BulkReturnRefLoan = Pick<
	DistributionLog,
	'_id' | 'is_returnable' | 'status' | 'qty' | 'qty_returned' | 'applied_bulk_entry_ids'
> &
	Partial<Pick<DistributionLog, 'ticket_id'>>;

export type BulkReturnRefAssessment =
	| { status: 'already_applied' }
	| { status: 'applicable' }
	| { status: 'skip'; reason: BulkReturnLoanDriftReason; outstanding?: string };

/**
 * Can `ref` of `entryId` be applied to `loan` now?
 * Order matters: a missing loan is `missing`; an entry id already in `applied_bulk_entry_ids` is
 * `already_applied` BEFORE the closed / insufficient checks (a replay of an applied ref stays
 * applied even when the loan has since been fully returned).
 */
export function assessBulkReturnRefOnLoan(
	loan: BulkReturnRefLoan | null | undefined,
	ref: { qty: string },
	entryId: string
): BulkReturnRefAssessment {
	if (!loan) return { status: 'skip', reason: 'missing' };
	if ((loan.applied_bulk_entry_ids ?? []).includes(entryId)) return { status: 'already_applied' };
	const outstanding = subQty(loan.qty, loan.qty_returned ?? '0');
	if (!loan.is_returnable || (loan.status !== 'active' && loan.status !== 'partially_returned')) {
		return { status: 'skip', reason: 'closed', outstanding };
	}
	if (qtyGt(ref.qty, outstanding)) return { status: 'skip', reason: 'insufficient', outstanding };
	return { status: 'applicable' };
}

export interface ClosedBulkReturnLoanRef {
	entry_id: string;
	distribution_log_id: string;
	qty: string;
	reason: BulkReturnLoanDriftReason;
	/** Outstanding on the loan now (absent for a missing loan). */
	outstanding?: string;
	/** Ticket the loan belongs to (absent for a missing loan); lets the UI link to the ticket. */
	ticket_id?: string;
}

/**
 * Refs of the given (non-voided) entries that are NOT applied to their loan and cannot be applied
 * now. `loansById` holds the freshly fetched loans (`null` / absent = missing). Entry order, then
 * ref order, is kept. Derived at read time: nothing is persisted.
 */
export function findClosedBulkReturnLoanRefs(
	entries: readonly Pick<BulkReturnEntry, '_id' | 'loan_refs'>[],
	loansById: ReadonlyMap<string, BulkReturnRefLoan | null | undefined>
): ClosedBulkReturnLoanRef[] {
	const out: ClosedBulkReturnLoanRef[] = [];
	for (const entry of entries) {
		for (const ref of entry.loan_refs) {
			const loan = loansById.get(ref.distribution_log_id);
			const assessment = assessBulkReturnRefOnLoan(loan, ref, entry._id);
			if (assessment.status !== 'skip') continue;
			out.push({
				entry_id: entry._id,
				distribution_log_id: ref.distribution_log_id,
				qty: ref.qty,
				reason: assessment.reason,
				...(assessment.outstanding !== undefined ? { outstanding: assessment.outstanding } : {}),
				...(loan?.ticket_id ? { ticket_id: loan.ticket_id } : {})
			});
		}
	}
	return out;
}

export interface MissedBulkReturnLoanRef {
	entry_id: string;
	distribution_log_id: string;
	qty: string;
}

/**
 * Refs of the given entries that were planned but never applied although the loan can still take
 * the whole ref (`applicable`: not listing the entry in `applied_bulk_entry_ids`). Typically an add
 * whose fence timed out before the loans were cut. Refs that cannot be applied anymore are the
 * closed refs (`findClosedBulkReturnLoanRefs`), not these. Entry order, then ref order, is kept.
 */
export function findMissedLoanRefs(
	entries: readonly Pick<BulkReturnEntry, '_id' | 'loan_refs'>[],
	loansById: ReadonlyMap<string, BulkReturnRefLoan | null | undefined>
): MissedBulkReturnLoanRef[] {
	const out: MissedBulkReturnLoanRef[] = [];
	for (const entry of entries) {
		for (const ref of entry.loan_refs) {
			const assessment = assessBulkReturnRefOnLoan(
				loansById.get(ref.distribution_log_id),
				ref,
				entry._id
			);
			if (assessment.status !== 'applicable') continue;
			out.push({ entry_id: entry._id, distribution_log_id: ref.distribution_log_id, qty: ref.qty });
		}
	}
	return out;
}

export interface AppliedBulkReturnLoanRef {
	entry_id: string;
	distribution_log_id: string;
	qty: string;
}

/**
 * Refs of the given entries that are actually applied on their loan (the entry id is in the loan's
 * `applied_bulk_entry_ids`). Entry order, then ref order, is kept. Derived at read time.
 */
export function findAppliedBulkReturnLoanRefs(
	entries: readonly Pick<BulkReturnEntry, '_id' | 'loan_refs'>[],
	loansById: ReadonlyMap<string, BulkReturnRefLoan | null | undefined>
): AppliedBulkReturnLoanRef[] {
	const out: AppliedBulkReturnLoanRef[] = [];
	for (const entry of entries) {
		for (const ref of entry.loan_refs) {
			const assessment = assessBulkReturnRefOnLoan(
				loansById.get(ref.distribution_log_id),
				ref,
				entry._id
			);
			if (assessment.status !== 'already_applied') continue;
			out.push({
				entry_id: entry._id,
				distribution_log_id: ref.distribution_log_id,
				qty: ref.qty
			});
		}
	}
	return out;
}
