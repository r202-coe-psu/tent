import { describe, it, expect } from 'vitest';
import { REFERRAL_LIST_CAP, isReferralListCapReached } from './referral.ui-helpers';

describe('REFERRAL_LIST_CAP', () => {
	it('equals the server default list limit (50 rows, no paging yet)', () => {
		expect(REFERRAL_LIST_CAP).toBe(50);
	});
});

describe('isReferralListCapReached', () => {
	it('is false below the cap so no banner is shown', () => {
		expect(isReferralListCapReached(0)).toBe(false);
		expect(isReferralListCapReached(REFERRAL_LIST_CAP - 1)).toBe(false);
	});

	it('is true exactly at the cap, where older rows may be hidden', () => {
		expect(isReferralListCapReached(REFERRAL_LIST_CAP)).toBe(true);
	});

	it('is true above the cap', () => {
		expect(isReferralListCapReached(REFERRAL_LIST_CAP + 1)).toBe(true);
	});

	it('honours an explicit cap argument', () => {
		expect(isReferralListCapReached(9, 10)).toBe(false);
		expect(isReferralListCapReached(10, 10)).toBe(true);
	});
});
