/**
 * Receiving one booking point by point (CR-206). A booking whose lines name drop-off points
 * is recorded one `point_receipts[]` entry at a time and closed once — when every line has a
 * result, when staff press "ปิดใบ", or when the worker finds it past `expires_at`.
 *
 * `closeDonationByPoints` is mirrored by `worker/src/worker/donation_close.py`; both read
 * `packages/donation-close-fixtures/cases.json`.
 */
import {
	donationShortfall,
	type DonationCloseReason,
	type DonationItem,
	type DonationPointReceipt
} from '$lib/features/operations';
import { rejectRemainingLines, hasLineReview } from './item-review';
import {
	combineLineRejectReasons,
	donorRejectMessage,
	type DonationRejectReasonCode
} from './reject-reason';

type ReceiptSource = { point_receipts?: readonly Pick<DonationPointReceipt, 'line_nos'>[] | null };

/** Lines some point already recorded, received or turned away (FR-MP-5a). */
export function recordedLineNos(donation: ReceiptSource): Set<number> {
	return new Set((donation.point_receipts ?? []).flatMap((receipt) => receipt.line_nos));
}

type ReceivedSource = {
	point_receipts?:
		| readonly (Pick<DonationPointReceipt, 'line_nos'> & {
				items?: readonly { line_no: number; rejected?: boolean }[];
		  })[]
		| null;
};

/**
 * Lines some point took in (FR-MP-5a) — recorded and not turned away there. A line a point
 * refused is out of this set: review refusing it too only says the same thing twice.
 */
export function receivedLineNos(donation: ReceivedSource): Set<number> {
	const received = new Set<number>();
	for (const receipt of donation.point_receipts ?? []) {
		for (const lineNo of receipt.line_nos) {
			const result = receipt.items?.find((line) => line.line_no === lineNo);
			if (!result?.rejected) received.add(lineNo);
		}
	}
	return received;
}

/**
 * The lines a review would refuse although a point already received them: the receipt and
 * `received_summary` would count goods on the shelf that the donor reads as refused.
 */
export function refusedReceivedLines(
	donation: ReceivedSource,
	decisions: readonly { index: number; decision: 'approved' | 'rejected' }[]
): number[] {
	const received = receivedLineNos(donation);
	return decisions
		.filter(({ index, decision }) => decision === 'rejected' && received.has(index))
		.map(({ index }) => index)
		.sort((a, b) => a - b);
}

/** True once any point recorded a receipt — the booking is then started (FR-MP-17a). */
export function hasPointReceipts(donation: ReceiptSource): boolean {
	return (donation.point_receipts ?? []).length > 0;
}

/**
 * The point a line goes to, or `null` when it may be received anywhere: no point, or a point
 * the shelter no longer offers (unticked or deleted after booking — FR-MP-16, FR-MP-19).
 */
export function currentLinePoint(
	item: Pick<DonationItem, 'drop_off_point_id'>,
	currentPointIds: ReadonlySet<string>
): string | null {
	const id = item.drop_off_point_id ?? null;
	return id !== null && currentPointIds.has(id) ? id : null;
}

/**
 * Whether the booking is received point by point (FR-MP-22a, FR-MP-24): it already has a
 * receipt, or a line names a point the shelter still offers. Otherwise it is received whole.
 */
export function isReceivedByPoint(
	donation: ReceiptSource & { items?: readonly Pick<DonationItem, 'drop_off_point_id'>[] },
	currentPointIds: ReadonlySet<string>
): boolean {
	return (
		hasPointReceipts(donation) ||
		(donation.items ?? []).some((item) => currentLinePoint(item, currentPointIds) !== null)
	);
}

/** A line refused at review keeps its refusal through the counter (CR-174) — it needs no receipt. */
function isReviewRejected(item: DonationItem): boolean {
	return item.review_status === 'rejected';
}

/**
 * Every line has a result (FR-MP-23): recorded at a point, or refused at review. A
 * review-refused line on a point nobody visits would otherwise keep the booking open.
 */
export function allLinesRecorded(
	donation: ReceiptSource & { items?: readonly DonationItem[] }
): boolean {
	const recorded = recordedLineNos(donation);
	return (donation.items ?? []).every(
		(item, lineNo) => recorded.has(lineNo) || isReviewRejected(item)
	);
}

export type DonationCloseSource = {
	items?: readonly DonationItem[];
	point_receipts?: readonly DonationPointReceipt[] | null;
};

export type ClosedSummaryItem = {
	item_id?: string;
	free_text?: string;
	qty: string;
	unit: string;
	rejected?: true;
	reject_reason?: string;
	reject_reason_code?: DonationRejectReasonCode;
};

export type DonationCloseResult = {
	status: 'received' | 'rejected';
	/** Set with `received` only. */
	received_at?: string;
	reject_reason?: string;
	reject_reason_code?: DonationRejectReasonCode;
	/** Set when the booking is refused and its lines carry a review (CR-174 FR-12). */
	items?: DonationItem[];
	received_summary: {
		total_items: number;
		received_at: string;
		remarks?: string;
		closed_by: string;
		closed_reason: DonationCloseReason;
		shortfalls: { item_id: string; declared: string; counted: string; short: string }[];
		items: ClosedSummaryItem[];
	};
};

/**
 * Close a booking from its point receipts (FR-MP-27a, FR-MP-27b): `received_summary` is
 * written once, here. A line with no result counts `'0'` and so lands in `shortfalls`; a
 * refused line (at a point, or at review) is out of the comparison (CR-172 FR-13). Nothing
 * received at all → the booking is `rejected` with the lines' reasons (CR-172 FR-12).
 */
export function closeDonationByPoints(
	donation: DonationCloseSource,
	opts: { closedBy: string; closedReason: DonationCloseReason; now: string }
): DonationCloseResult {
	const declared = donation.items ?? [];
	const results = new Map<number, ClosedSummaryItem>();
	for (const receipt of donation.point_receipts ?? []) {
		for (const { line_no, ...line } of receipt.items) {
			results.set(line_no, {
				...(line.item_id !== undefined ? { item_id: line.item_id } : {}),
				...(line.free_text !== undefined ? { free_text: line.free_text } : {}),
				qty: line.rejected ? '0' : line.qty,
				unit: line.unit,
				...(line.rejected
					? {
							rejected: true as const,
							...(line.reject_reason !== undefined ? { reject_reason: line.reject_reason } : {}),
							...(line.reject_reason_code !== undefined
								? { reject_reason_code: line.reject_reason_code as DonationRejectReasonCode }
								: {})
						}
					: {})
			});
		}
	}

	const items: ClosedSummaryItem[] = declared.map((item, lineNo) => {
		const recorded = results.get(lineNo);
		if (recorded) return recorded;
		const base = {
			...(item.item_id !== undefined ? { item_id: item.item_id } : {}),
			...(item.free_text !== undefined ? { free_text: item.free_text } : {}),
			qty: '0',
			unit: item.unit
		};
		if (!isReviewRejected(item)) return base;
		const code = (item.review_reason_code ?? 'other') as DonationRejectReasonCode;
		return {
			...base,
			rejected: true as const,
			reject_reason: item.review_reason?.trim() || donorRejectMessage(code),
			reject_reason_code: code
		};
	});

	// A typed-in line is compared under the stock item staff matched it to at the point.
	const declaredForShortfall = declared.flatMap((item, lineNo) =>
		items[lineNo].rejected
			? []
			: [{ item_id: item.item_id || items[lineNo].item_id || item.free_text, qty: item.qty }]
	);
	const countedForShortfall = items.flatMap((line, lineNo) =>
		line.rejected || !results.has(lineNo)
			? []
			: [{ item_id: line.item_id || line.free_text, qty: line.qty }]
	);
	const shortfalls = donationShortfall(declaredForShortfall, countedForShortfall);

	const remarks = (donation.point_receipts ?? [])
		.map((receipt) => receipt.remarks?.trim() ?? '')
		.filter((text) => text !== '')
		.join('\n');
	const received_summary: DonationCloseResult['received_summary'] = {
		total_items: declared.length,
		received_at: opts.now,
		...(remarks ? { remarks } : {}),
		closed_by: opts.closedBy,
		closed_reason: opts.closedReason,
		shortfalls,
		items
	};

	const anyReceived = items.some((line, lineNo) => !line.rejected && results.has(lineNo));
	if (anyReceived) {
		return { status: 'received', received_at: opts.now, received_summary };
	}
	const rejections = items.flatMap((line) =>
		line.rejected
			? [
					{
						reject_reason: line.reject_reason ?? '',
						reject_reason_code: line.reject_reason_code ?? 'other'
					}
				]
			: []
	);
	return {
		status: 'rejected',
		...combineLineRejectReasons(rejections),
		...(hasLineReview(declared) ? { items: rejectRemainingLines(declared) } : {}),
		received_summary
	};
}
