import { describe, expect, it } from 'vitest';
import { toggleMemberSelection, unassignedRegistrationClaimResponseSchema } from './claim';

describe('claim selection helpers', () => {
	it('toggles member ids without mutating the prior selection', () => {
		const base = ['evacuee:a'];
		expect(toggleMemberSelection(base, 'evacuee:b', true)).toEqual(['evacuee:a', 'evacuee:b']);
		expect(base).toEqual(['evacuee:a']);
		expect(toggleMemberSelection(['evacuee:a', 'evacuee:b'], 'evacuee:a', false)).toEqual([
			'evacuee:b'
		]);
	});
});

describe('unassignedRegistrationClaimResponseSchema', () => {
	const valid = {
		success: true,
		id: 'reg1',
		deleted: false,
		shelter_code: 'SH001',
		household_id: 'household:1',
		evacuee_ids: ['evacuee:a'],
		claimed: [
			{
				reserved_evacuee_id: 'evacuee:a',
				status: 'claimed' as const,
				first_name: 'สมชาย',
				last_name: 'ใจดี'
			}
		],
		remaining_open: [
			{
				reserved_evacuee_id: 'evacuee:b',
				status: 'open' as const,
				first_name: 'สมหญิง',
				last_name: 'ใจดี',
				gender: 'female',
				phone: null,
				person_id: null,
				country: 'THAILAND',
				vulnerable_groups: [],
				special_needs: []
			}
		]
	};

	it('parses a full claim response', () => {
		expect(unassignedRegistrationClaimResponseSchema.parse(valid)).toEqual(valid);
	});

	it('rejects a response missing claimed members', () => {
		expect(() =>
			unassignedRegistrationClaimResponseSchema.parse({ ...valid, claimed: undefined })
		).toThrow();
	});
});
