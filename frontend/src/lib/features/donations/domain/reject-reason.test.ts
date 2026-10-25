import { describe, expect, it } from 'vitest';
import {
	combineLineRejectReasons,
	donorRejectMessage,
	rejectDonationInputSchema,
	REJECT_REASON_MAX
} from './reject-reason';

describe('donorRejectMessage (CR-172)', () => {
	it('reads the preset alone when staff add nothing', () => {
		expect(donorRejectMessage('expired')).toBe('หมดอายุ');
	});

	it('puts the detail after the preset', () => {
		expect(donorRejectMessage('damaged', ' กล่องเปียก ')).toBe('ชำรุดเสียหาย — กล่องเปียก');
	});

	it('uses only the detail for "other" — the label says nothing to the donor', () => {
		expect(donorRejectMessage('other', 'ศูนย์ปิดรับชั่วคราว')).toBe('ศูนย์ปิดรับชั่วคราว');
	});

	it('never exceeds the field limit', () => {
		expect(donorRejectMessage('other', 'ก'.repeat(900)).length).toBe(REJECT_REASON_MAX);
	});
});

describe('rejectDonationInputSchema (FR-6, AC-4)', () => {
	it('accepts a preset with or without a detail', () => {
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'not_needed' }).success).toBe(true);
		expect(
			rejectDonationInputSchema.safeParse({ reason_code: 'expired', note: 'ล็อตเก่า' }).success
		).toBe(true);
	});

	it('refuses "other" without a detail, and an unknown code', () => {
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'other' }).success).toBe(false);
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'other', note: '  ' }).success).toBe(
			false
		);
		expect(rejectDonationInputSchema.safeParse({ reason_code: 'nope' }).success).toBe(false);
	});
});

describe('combineLineRejectReasons (FR-12)', () => {
	it('keeps the shared code when every line agrees, and says each reason once', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' },
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' }
			])
		).toEqual({ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' });
	});

	it('falls back to "other" when the lines were turned away for different reasons', () => {
		expect(
			combineLineRejectReasons([
				{ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' },
				{ reject_reason: 'ชำรุดเสียหาย', reject_reason_code: 'damaged' }
			])
		).toEqual({ reject_reason: 'หมดอายุ; ชำรุดเสียหาย', reject_reason_code: 'other' });
	});
});
