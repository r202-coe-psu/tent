import { describe, it, expect, vi } from 'vitest';

vi.mock('$lib/db/shelter', () => ({
	getShelterCode: () => 'SH001'
}));

import {
	REFERRAL_LIST_CAP,
	isReferralListCapReached,
	getEvacueeSelectionError,
	resolveEvacueeName,
	EVACUEE_NAME_FALLBACK
} from './referral.ui-helpers';

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

describe('getEvacueeSelectionError', () => {
	it('returns the Thai required-selection message when no evacuee is selected', () => {
		expect(getEvacueeSelectionError([])).toBe('กรุณาเลือกผู้ประสบภัยอย่างน้อย 1 คน');
	});

	it('returns undefined when at least one evacuee is selected', () => {
		expect(getEvacueeSelectionError(['evacuee:01A'])).toBeUndefined();
		expect(getEvacueeSelectionError(['evacuee:01A', 'evacuee:01B'])).toBeUndefined();
	});
});

describe('resolveEvacueeName', () => {
	const roster = { first_name: 'สมชาย', last_name: 'ใจดี' };
	const summary = { first_name: 'สมหญิง', last_name: 'รักดี' };

	it('prefers the roster name over the summary', () => {
		expect(resolveEvacueeName(roster, summary)).toBe('สมชาย ใจดี');
	});

	it('falls back to the summary when the roster has no match', () => {
		expect(resolveEvacueeName(undefined, summary)).toBe('สมหญิง รักดี');
		expect(resolveEvacueeName(null, summary)).toBe('สมหญิง รักดี');
	});

	it('returns the shared fallback text when no source has a name', () => {
		expect(resolveEvacueeName()).toBe(EVACUEE_NAME_FALLBACK);
		expect(resolveEvacueeName(undefined, undefined)).toBe('ไม่พบชื่อผู้ประสบภัย');
	});
});
