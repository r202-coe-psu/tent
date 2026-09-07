import { describe, expect, it } from 'vitest';
import { formatOpenMemberName, isOnlineRequiredError } from './search';

describe('formatOpenMemberName', () => {
	it('joins first and last name', () => {
		expect(
			formatOpenMemberName({
				reserved_evacuee_id: 'evacuee:1',
				status: 'open',
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				gender: 'male',
				phone: null,
				person_id: null,
				country: 'THAILAND',
				vulnerable_groups: [],
				special_needs: []
			})
		).toBe('สมชาย ใจดี');
	});
});

describe('isOnlineRequiredError', () => {
	it('detects ONLINE_REQUIRED envelope shapes', () => {
		expect(isOnlineRequiredError({ code: 'ONLINE_REQUIRED' })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'ONLINE_REQUIRED' } })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'OTHER' } })).toBe(false);
	});
});
