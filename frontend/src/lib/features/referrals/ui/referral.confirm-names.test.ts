import { describe, it, expect } from 'vitest';
import { formatReferralNameSummary, REFERRAL_CONFIRM_NAME_LIMIT } from './referral.ui-helpers';

function names(count: number): string[] {
	return Array.from({ length: count }, (_, i) => `ผู้ประสบภัย${i + 1}`);
}

describe('formatReferralNameSummary', () => {
	it('uses a limit of 5 names for confirm dialogs', () => {
		expect(REFERRAL_CONFIRM_NAME_LIMIT).toBe(5);
	});

	it('returns an empty string when there are no names', () => {
		expect(formatReferralNameSummary([])).toBe('');
	});

	it('lists a single name without a remainder suffix', () => {
		expect(formatReferralNameSummary(['สมชาย ใจดี'])).toBe('สมชาย ใจดี');
	});

	it('lists exactly 5 names without a remainder suffix', () => {
		expect(formatReferralNameSummary(names(5))).toBe(
			'ผู้ประสบภัย1, ผู้ประสบภัย2, ผู้ประสบภัย3, ผู้ประสบภัย4, ผู้ประสบภัย5'
		);
	});

	it('shows 5 names and "และอีก 1 คน" for 6 names', () => {
		expect(formatReferralNameSummary(names(6))).toBe(
			'ผู้ประสบภัย1, ผู้ประสบภัย2, ผู้ประสบภัย3, ผู้ประสบภัย4, ผู้ประสบภัย5 และอีก 1 คน'
		);
	});

	it('shows 5 names and "และอีก 15 คน" for 20 names', () => {
		expect(formatReferralNameSummary(names(20))).toBe(
			'ผู้ประสบภัย1, ผู้ประสบภัย2, ผู้ประสบภัย3, ผู้ประสบภัย4, ผู้ประสบภัย5 และอีก 15 คน'
		);
	});

	it('honours an explicit limit', () => {
		expect(formatReferralNameSummary(names(3), 2)).toBe('ผู้ประสบภัย1, ผู้ประสบภัย2 และอีก 1 คน');
	});
});
