import { addQty, qtyGt, subQty } from '$lib/utils/qty';
import { deriveDeterministicLedgerId } from './deterministic-ledger-id';
import type { CountedItem, Donation } from './operations';

/**
 * Batch receive of a donation (CR-143 §B): every line of the ticket is counted and
 * keyed in one write. Pure helpers only — the write itself is
 * `OperationsRepository.receiveDonationBatch`.
 */

/** Namespace of the deterministic `_id` of a batch-receipt row (FR-B4a). */
const DONATION_RECEIPT_NAMESPACE = 'donation_receipt';
const DONATION_RECEIPT_AUDIT_NAMESPACE = 'donation_receipt_audit';
/** A receipt of some lines at a drop-off point (CR-206 FR-MP-22c) — never the whole-booking id. */
const DONATION_POINT_RECEIPT_AUDIT_NAMESPACE = 'donation_point_receipt_audit';
/** Staff pressing "ปิดใบ" on a booking received point by point (CR-206 FR-MP-27). */
const DONATION_CLOSE_AUDIT_NAMESPACE = 'donation_close_audit';

/**
 * One line of the batch. `line_no` is the line's identity for the lifetime of the
 * receipt: it is part of the row's `_id`, so it must not change when another line
 * is added, removed or reordered — a retry would otherwise point at a different row.
 * `qty` may be `'0'` (FR-B3): the line was not received and writes nothing.
 */
export interface DonationBatchLine extends CountedItem {
	line_no: number;
}

/** What the repository did with one line. */
export type DonationBatchLineState = 'saved' | 'failed' | 'skipped';

export interface DonationBatchLineResult {
	line_no: number;
	item_id: string;
	state: DonationBatchLineState;
	/** Deterministic `_id` of the row (absent for a `skipped` zero line). */
	ledger_id?: string;
	/** Why a `failed` line did not land. */
	error?: string;
}

/** Outcome of one `receiveDonationBatch` call (never thrown for a partial write — FR-B7). */
export interface DonationBatchResult {
	/** The donation as last read; `status: 'received'` only once {@link received}. */
	donation: Donation;
	lines: DonationBatchLineResult[];
	/** Every received (qty > 0) line is in the ledger. */
	rowsComplete: boolean;
	/** The donation is `received`. False while a row or the transition is outstanding. */
	received: boolean;
	/** Set when every row landed but the donation could not be moved to `received` (FR-B8). */
	transitionError?: string;
	/**
	 * The booking changed while its rows were keyed, so retrying the transition cannot close
	 * it — someone has to check the stock against the booking first (S-R4-1).
	 */
	transitionBlocked?: boolean;
}

/**
 * `_id` of the ledger row of one donation line: deterministic in
 * `(donation id, item id, line number)` so re-sending the same line can never
 * create a second row (FR-B4a, AC-B5).
 */
export function deriveDonationReceiptLineId(
	donationId: string,
	itemId: string,
	lineNo: number
): Promise<string> {
	return deriveDeterministicLedgerId(
		DONATION_RECEIPT_NAMESPACE,
		donationId,
		itemId,
		String(lineNo)
	);
}

/**
 * `_id` of the audit entry for receiving one donation at the scan station: one per
 * donation, so a retried receive cannot log the same receipt twice (#695).
 *
 * With `lineNos` (CR-206 FR-MP-22c) it is one per set of lines a drop-off point recorded —
 * order does not matter, so a retry of the same lines gets the same id while another point
 * recording other lines gets its own. Without it the id is the per-booking one, unchanged.
 */
export async function deriveDonationReceiptAuditId(
	donationId: string,
	lineNos?: readonly number[]
): Promise<string> {
	const ledgerId =
		lineNos === undefined
			? await deriveDeterministicLedgerId(DONATION_RECEIPT_AUDIT_NAMESPACE, donationId)
			: await deriveDeterministicLedgerId(
					DONATION_POINT_RECEIPT_AUDIT_NAMESPACE,
					donationId,
					[...lineNos].sort((a, b) => a - b).join(',')
				);
	return `audit:${ledgerId.slice('stock_ledger:'.length)}`;
}

/** `_id` of the audit entry for staff closing a booking received point by point (CR-206 FR-MP-27). */
export async function deriveDonationCloseAuditId(donationId: string): Promise<string> {
	const ledgerId = await deriveDeterministicLedgerId(DONATION_CLOSE_AUDIT_NAMESPACE, donationId);
	return `audit:${ledgerId.slice('stock_ledger:'.length)}`;
}

export interface DonationShortfall {
	item_id: string;
	declared: string;
	counted: string;
	/** `declared − counted`, always > 0. */
	short: string;
}

/**
 * "Received less than declared", derived per item (FR-B5) — there is no status for
 * it. Lines are summed per `item_id` on both sides. Declared lines without an
 * `item_id` are ignored: resolve a `free_text` line to an item first (FR-B2).
 * Items counted beyond the declaration are not shortfalls.
 */
export function donationShortfall(
	declared: readonly { item_id?: string | null; qty: string }[],
	counted: readonly { item_id?: string | null; qty: string }[]
): DonationShortfall[] {
	const declaredByItem = new Map<string, string>();
	for (const line of declared) {
		if (!line.item_id) continue;
		declaredByItem.set(line.item_id, addQty(declaredByItem.get(line.item_id) ?? '0', line.qty));
	}
	const countedByItem = new Map<string, string>();
	for (const line of counted) {
		if (!line.item_id) continue;
		countedByItem.set(line.item_id, addQty(countedByItem.get(line.item_id) ?? '0', line.qty));
	}

	const shortfalls: DonationShortfall[] = [];
	for (const [item_id, declaredQty] of declaredByItem) {
		const countedQty = countedByItem.get(item_id) ?? '0';
		const short = subQty(declaredQty, countedQty);
		if (qtyGt(short, 0))
			shortfalls.push({ item_id, declared: declaredQty, counted: countedQty, short });
	}
	return shortfalls;
}

/** Lines that become ledger rows: a zero line is "not received" (FR-B3, AC-B3). */
export function isReceivedLine(line: { qty: string }): boolean {
	return qtyGt(line.qty, 0);
}
