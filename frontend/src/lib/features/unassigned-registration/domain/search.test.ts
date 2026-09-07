import { describe, expect, it } from 'vitest';
import { formatOpenMemberName, isOnlineRequiredError, openMemberHitSchema } from './search';

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

describe('openMemberHitSchema', () => {
	it('parses an open member hit', () => {
		const hit = {
			reserved_evacuee_id: 'evacuee:1',
			status: 'open' as const,
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: null,
			person_id: null,
			country: 'THAILAND',
			vulnerable_groups: [],
			special_needs: []
		};
		expect(openMemberHitSchema.parse(hit)).toEqual(hit);
	});
});

describe('isOnlineRequiredError', () => {
	it('detects ONLINE_REQUIRED envelope shapes', () => {
		expect(isOnlineRequiredError({ code: 'ONLINE_REQUIRED' })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'ONLINE_REQUIRED' } })).toBe(true);
		expect(isOnlineRequiredError({ error: { code: 'OTHER' } })).toBe(false);
	});
});
