import { describe, expect, it } from 'vitest';
import { staffRecipientLabel } from './staff-recipient-label';

const directory = [
	{ name: 'somchai', display_name: 'สมชาย ใจดี' },
	{ name: 'malee', display_name: null }
];

describe('staffRecipientLabel', () => {
	it('shows the display name of the matching staff member', () => {
		expect(staffRecipientLabel('user:somchai', directory)).toBe('สมชาย ใจดี');
	});

	it('falls back to the username when the directory has no match', () => {
		expect(staffRecipientLabel('user:nobody', directory)).toBe('nobody');
	});

	it('falls back to the username while the directory is still loading', () => {
		expect(staffRecipientLabel('user:somchai', undefined)).toBe('somchai');
	});

	it('falls back to the username when the matching entry has no display name', () => {
		expect(staffRecipientLabel('user:malee', directory)).toBe('malee');
	});

	it('returns the raw id when it is not a staff recipient id', () => {
		expect(staffRecipientLabel('EV-0001', directory)).toBe('EV-0001');
	});
});
