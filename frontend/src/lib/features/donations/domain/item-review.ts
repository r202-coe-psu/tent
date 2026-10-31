import { z } from 'zod';
import type { DonationItem } from '$lib/features/operations';
import {
	combineLineRejectReasons,
	donationRejectReasonCodeSchema,
	donorRejectMessage,
	rejectNoteSchema,
	requireNoteForOther,
	type DonationRejectReasonCode
} from './reject-reason';

/**
 * Review one line at a time (CR-174).
 *
 * FastAPI stamps `review_status` when the donor books or edits; staff decide the
 * `pending` lines here. The booking's status follows from its lines (FR-4..FR-6).
 * A doc from before schema_v 7 has no `review_status` on any line and is still
 * reviewed as a whole, by `status` (AC-8).
 */
export type ItemReviewStatus = NonNullable<DonationItem['review_status']>;

/** True once FastAPI (or staff) has stamped the lines — schema_v 7 and later. */
export function hasLineReview(items: readonly DonationItem[] | undefined): boolean {
	return (items ?? []).some((item) => item.review_status !== undefined);
}

/**
 * FR-4..FR-6 — any line still `pending` keeps the booking in review; otherwise one
 * `approved` line is enough for the QR; only a booking every line of which was refused is
 * rejected. Mirrors `booking_status` in `backend/apiapp/modules/donations/review.py`.
 */
export function donationStatusFromLines(
	items: readonly DonationItem[]
): 'pending_review' | 'verifying' | 'rejected' {
	if (items.some((item) => item.review_status === 'pending')) return 'pending_review';
	if (items.some((item) => item.review_status === 'approved')) return 'verifying';
	if (items.length > 0 && items.every((item) => item.review_status === 'rejected')) {
		return 'rejected';
	}
	// No lines, or a line without a review status (pre-schema_v 7): nothing here can be
	// judged, so the booking waits for a person rather than being refused by accident.
	return 'pending_review';
}

/**
 * FR-8 — staff see where an approval came from. A campaign line FastAPI could reserve
 * quota for was approved at booking time (FR-2); anything else approved was a person.
 * `reserved_qty` is the reservation: a campaign line the counter did not hold (not
 * seeded yet) waited for staff, and a person approved it.
 */
export function isAutoApprovedLine(item: DonationItem, campaignId: string | null): boolean {
	return item.review_status === 'approved' && !!item.item_id && !!campaignId && !!item.reserved_qty;
}

/**
 * FR-12 — however a booking ends `rejected`, every line not already rejected goes with
 * it in the same write. The reason lives on the booking (CR-172), not on each line.
 */
export function rejectRemainingLines<T extends DonationItem>(items: readonly T[]): T[] {
	return items.map((item) =>
		item.review_status === 'rejected' ? item : { ...item, review_status: 'rejected' as const }
	);
}

/**
 * One decision on a `pending` line, by its position in `items`. `drop_off_point_id` is the
 * point staff send an approved line to; absent keeps the line's point.
 */
export const lineReviewDecisionSchema = z
	.object({
		index: z.number().int().min(0),
		decision: z.enum(['approved', 'rejected']),
		reason_code: donationRejectReasonCodeSchema.optional(),
		note: rejectNoteSchema.optional(),
		drop_off_point_id: z.string().min(1).nullable().optional()
	})
	.superRefine((value, ctx) => {
		if (value.decision !== 'rejected') return;
		if (value.drop_off_point_id !== undefined) {
			ctx.addIssue({
				code: 'custom',
				path: ['drop_off_point_id'],
				message: 'รายการที่ไม่รับไม่ต้องระบุจุดรับบริจาค'
			});
		}
		if (!value.reason_code) {
			ctx.addIssue({ code: 'custom', path: ['reason_code'], message: 'ต้องระบุเหตุผลที่ไม่รับ' });
		}
		requireNoteForOther(value, ctx);
	});
export type LineReviewDecision = z.infer<typeof lineReviewDecisionSchema>;

/**
 * Body of `POST /api/back-office/donations/[query]/approve`. Without `lines` the whole
 * booking is approved (pre-schema_v 7 docs, and the old one-button flow). With them,
 * every `pending` line must be decided exactly once (FR-10).
 */
export const reviewDonationInputSchema = z.object({
	memo: z.string().trim().max(500).optional(),
	lines: z.array(lineReviewDecisionSchema).optional()
});
export type ReviewDonationInput = z.infer<typeof reviewDonationInputSchema>;

export type LineReviewResult<T extends DonationItem> = {
	items: T[];
	status: 'pending_review' | 'verifying' | 'rejected';
	reject_reason?: string;
	reject_reason_code?: DonationRejectReasonCode;
};

/**
 * Apply staff decisions to the `pending` lines. Throws when a decision names a line
 * that is not pending, names one twice, refuses one without a reason, or leaves a
 * pending line undecided.
 */
export function applyLineReview<T extends DonationItem>(
	items: readonly T[],
	decisions: readonly LineReviewDecision[]
): LineReviewResult<T> {
	const byIndex = new Map<number, LineReviewDecision>();
	for (const decision of decisions) {
		if (byIndex.has(decision.index)) {
			throw new Error(`Line ${decision.index} is decided twice`);
		}
		if (items[decision.index]?.review_status !== 'pending') {
			throw new Error(`Line ${decision.index} is not waiting for review`);
		}
		byIndex.set(decision.index, decision);
	}
	const undecided = items.findIndex(
		(item, index) => item.review_status === 'pending' && !byIndex.has(index)
	);
	if (undecided >= 0) throw new Error(`Line ${undecided} has not been decided`);

	const reviewed = items.map((item, index) => {
		const decision = byIndex.get(index);
		if (!decision) return item;
		if (decision.decision === 'approved') {
			return {
				...item,
				review_status: 'approved' as const,
				review_reason_code: null,
				review_reason: null
			};
		}
		// `lineReviewDecisionSchema` requires a code on a refusal; a caller that skipped it
		// must not compose "undefined" into the text the donor reads.
		if (!decision.reason_code) throw new Error(`Line ${index} is refused without a reason`);
		const code = decision.reason_code as DonationRejectReasonCode;
		return {
			...item,
			review_status: 'rejected' as const,
			review_reason_code: code,
			review_reason: donorRejectMessage(code, decision.note)
		};
	});

	const status = donationStatusFromLines(reviewed);
	if (status !== 'rejected') return { items: reviewed, status };
	// Every line refused at review: the booking carries the reasons for the tracking page.
	const combined = combineLineRejectReasons(
		reviewed
			.filter((item) => item.review_reason)
			.map((item) => ({
				reject_reason: item.review_reason as string,
				reject_reason_code: item.review_reason_code as DonationRejectReasonCode
			}))
	);
	return { items: reviewed, status, ...combined };
}
