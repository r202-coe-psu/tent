import { describe, expect, it } from 'vitest';
import type { DonationItem } from '$lib/features/operations';
import {
	applyLineReview,
	donationStatusFromLines,
	hasLineReview,
	isAutoApprovedLine,
	lineReviewDecisionSchema,
	rejectRemainingLines
} from './item-review';

const line = (over: Partial<DonationItem>): DonationItem => ({ qty: '1', unit: 'piece', ...over });
const campaignLine = line({ item_id: 'item:rice', review_status: 'approved', reserved_qty: '1' });
const typedLine = line({ free_text: 'ผ้าห่ม', review_status: 'pending' });

describe('donationStatusFromLines (CR-174 FR-4..FR-6)', () => {
	it('keeps a booking with any pending line in review', () => {
		expect(donationStatusFromLines([campaignLine, typedLine])).toBe('pending_review');
	});

	it('gives the QR once nothing waits and something was approved', () => {
		expect(
			donationStatusFromLines([campaignLine, { ...typedLine, review_status: 'rejected' }])
		).toBe('verifying');
	});

	it('refuses the booking when every line was refused', () => {
		expect(donationStatusFromLines([{ ...typedLine, review_status: 'rejected' }])).toBe('rejected');
	});

	// S1 — same answer as `booking_status` in review.py for what FR-4..FR-6 do not cover.
	it('keeps a booking with no lines in review', () => {
		expect(donationStatusFromLines([])).toBe('pending_review');
	});

	it('keeps a booking with an unreviewed older line in review, not refused', () => {
		const older = line({ free_text: 'ข้าว' });
		expect(donationStatusFromLines([{ ...typedLine, review_status: 'rejected' }, older])).toBe(
			'pending_review'
		);
	});
});

describe('hasLineReview (AC-8)', () => {
	it('tells a schema_v 7 basket from an older one reviewed as a whole', () => {
		expect(hasLineReview([campaignLine])).toBe(true);
		expect(hasLineReview([line({ free_text: 'ข้าว' })])).toBe(false);
		expect(hasLineReview(undefined)).toBe(false);
	});
});

describe('isAutoApprovedLine (FR-8)', () => {
	it('labels a campaign line as approved by the campaign, a typed one as by staff', () => {
		expect(isAutoApprovedLine(campaignLine, 'donation_campaign:1')).toBe(true);
		expect(
			isAutoApprovedLine({ ...typedLine, review_status: 'approved' }, 'donation_campaign:1')
		).toBe(false);
		expect(isAutoApprovedLine(campaignLine, null)).toBe(false);
	});

	it('labels a campaign line the counter did not hold as approved by staff', () => {
		const unreserved = line({ item_id: 'item:rice', review_status: 'approved' });
		expect(isAutoApprovedLine(unreserved, 'donation_campaign:1')).toBe(false);
	});
});

describe('rejectRemainingLines (FR-12)', () => {
	it('rejects every line not already rejected, keeping earlier reasons', () => {
		const earlier = { ...typedLine, review_status: 'rejected' as const, review_reason: 'หมดอายุ' };
		expect(rejectRemainingLines([campaignLine, earlier]).map((i) => i.review_status)).toEqual([
			'rejected',
			'rejected'
		]);
		expect(rejectRemainingLines([earlier])[0].review_reason).toBe('หมดอายุ');
	});
});

describe('applyLineReview (FR-9, FR-10)', () => {
	it('AC-2: approving the typed line of a mixed booking gives it the QR', () => {
		const result = applyLineReview([campaignLine, typedLine], [{ index: 1, decision: 'approved' }]);
		expect(result.status).toBe('verifying');
		expect(result.items[1].review_status).toBe('approved');
	});

	it('AC-3: refusing the typed line keeps the campaign line and records the reason', () => {
		const result = applyLineReview(
			[campaignLine, typedLine],
			[{ index: 1, decision: 'rejected', reason_code: 'damaged', note: 'ขาด' }]
		);
		expect(result.status).toBe('verifying');
		expect(result.items[1]).toMatchObject({
			review_status: 'rejected',
			review_reason_code: 'damaged',
			review_reason: 'ชำรุดเสียหาย — ขาด'
		});
		expect(result.reject_reason).toBeUndefined();
	});

	it('AC-4: refusing every typed line refuses the booking with the reasons', () => {
		const result = applyLineReview(
			[typedLine, { ...typedLine, free_text: 'หมอน' }],
			[
				{ index: 0, decision: 'rejected', reason_code: 'not_needed' },
				{ index: 1, decision: 'rejected', reason_code: 'not_needed' }
			]
		);
		expect(result).toMatchObject({
			status: 'rejected',
			reject_reason: 'ไม่ตรงเกณฑ์การรับ / เกินความต้องการ',
			reject_reason_code: 'not_needed'
		});
	});

	it('refuses to decide a campaign line, a line twice, or to leave one undecided', () => {
		expect(() =>
			applyLineReview(
				[campaignLine, typedLine],
				[
					{ index: 0, decision: 'rejected', reason_code: 'expired' },
					{ index: 1, decision: 'approved' }
				]
			)
		).toThrow(/not waiting/);
		expect(() =>
			applyLineReview(
				[typedLine],
				[
					{ index: 0, decision: 'approved' },
					{ index: 0, decision: 'approved' }
				]
			)
		).toThrow(/twice/);
		expect(() =>
			applyLineReview([typedLine, typedLine], [{ index: 0, decision: 'approved' }])
		).toThrow(/not been decided/);
		expect(() => applyLineReview([typedLine], [{ index: 0, decision: 'rejected' }])).toThrow(
			/without a reason/
		);
	});
});

describe('lineReviewDecisionSchema drop-off point (FR-AP-17 step 1)', () => {
	it.each([
		['a point', { drop_off_point_id: 'point-gym' }, true],
		['null', { drop_off_point_id: null }, true],
		['no key', {}, true]
	])('accepts an approval with %s', (_label, point, expected) => {
		expect(
			lineReviewDecisionSchema.safeParse({ index: 0, decision: 'approved', ...point }).success
		).toBe(expected);
	});

	it.each([
		['a point', 'point-gym'],
		['null', null]
	])('refuses a refusal that names %s', (_label, point) => {
		const parsed = lineReviewDecisionSchema.safeParse({
			index: 0,
			decision: 'rejected',
			reason_code: 'damaged',
			drop_off_point_id: point
		});
		expect(parsed.success).toBe(false);
	});

	it('still accepts a refusal without a point', () => {
		expect(
			lineReviewDecisionSchema.safeParse({ index: 0, decision: 'rejected', reason_code: 'damaged' })
				.success
		).toBe(true);
	});
});
