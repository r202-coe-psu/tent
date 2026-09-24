import { describe, expect, it } from 'vitest';
import {
	EXCLUDE_SEARCH_OPT_OUT,
	groupPhoneMatches,
	isPhoneMatchEligible,
	type PhoneMatchDoc
} from './phone-match';

function evacuee(overrides: Partial<PhoneMatchDoc> & Pick<PhoneMatchDoc, '_id'>): PhoneMatchDoc {
	return {
		shelter_code: 'SH001',
		registered_via: 'web',
		household_id: 'household:01',
		created_at: '2026-09-01T00:00:00.000Z',
		current_stay: { status: 'pre_registered' },
		...overrides
	};
}

describe('groupPhoneMatches', () => {
	it('returns one group when multiple matched members share a household', () => {
		const docs = [evacuee({ _id: 'evacuee:02' }), evacuee({ _id: 'evacuee:01' })];
		const groups = groupPhoneMatches(docs, 'SH001', new Map([['household:01', 'evacuee:01']]));

		expect(groups).toHaveLength(1);
		expect(groups[0].matched).toHaveLength(2);
		expect(groups[0].primary._id).toBe('evacuee:01');
	});

	it('orders different households by primary created_at and then id', () => {
		const docs = [
			evacuee({ _id: 'evacuee:z', household_id: 'household:z', created_at: '2026-09-02' }),
			evacuee({ _id: 'evacuee:b', household_id: 'household:b', created_at: '2026-09-01' }),
			evacuee({ _id: 'evacuee:a', household_id: 'household:a', created_at: '2026-09-01' })
		];

		expect(groupPhoneMatches(docs, 'SH001', new Map()).map((group) => group.primary._id)).toEqual([
			'evacuee:a',
			'evacuee:b',
			'evacuee:z'
		]);
	});

	it('keeps every household_id:null result as a separate group', () => {
		const docs = [
			evacuee({ _id: 'evacuee:01', household_id: null }),
			evacuee({ _id: 'evacuee:02', household_id: null })
		];

		expect(groupPhoneMatches(docs, 'SH001', new Map())).toHaveLength(2);
	});

	it('uses the oldest matched member when the household head did not match', () => {
		const docs = [
			evacuee({ _id: 'evacuee:later', created_at: '2026-09-02' }),
			evacuee({ _id: 'evacuee:earlier', created_at: '2026-09-01' })
		];

		expect(
			groupPhoneMatches(docs, 'SH001', new Map([['household:01', 'evacuee:not-matched']]))[0]
				.primary._id
		).toBe('evacuee:earlier');
	});

	it('filters ineligible statuses, other shelters, non-web records, and privacy opt-outs', () => {
		const base = evacuee({ _id: 'evacuee:base' });
		expect(isPhoneMatchEligible(base, 'SH001')).toBe(true);
		expect(
			isPhoneMatchEligible(
				evacuee({ _id: 'evacuee:cancelled', current_stay: { status: 'cancelled' } }),
				'SH001'
			)
		).toBe(false);
		expect(
			isPhoneMatchEligible(
				evacuee({ _id: 'evacuee:checked-out', current_stay: { status: 'checked_out' } }),
				'SH001'
			)
		).toBe(false);
		expect(
			isPhoneMatchEligible(
				evacuee({ _id: 'evacuee:deceased', current_stay: { status: 'deceased' } }),
				'SH001'
			)
		).toBe(false);
		expect(
			isPhoneMatchEligible(evacuee({ _id: 'evacuee:other', shelter_code: 'SH002' }), 'SH001')
		).toBe(false);
		expect(
			isPhoneMatchEligible(evacuee({ _id: 'evacuee:staff', registered_via: 'staff' }), 'SH001')
		).toBe(false);
		expect(EXCLUDE_SEARCH_OPT_OUT).toBe(true);
		expect(
			isPhoneMatchEligible(
				evacuee({ _id: 'evacuee:hidden', privacy: { search_excluded: true } }),
				'SH001'
			)
		).toBe(false);
	});

	it('drops groups when every hit is ineligible', () => {
		const docs = [
			evacuee({ _id: 'evacuee:cancelled', current_stay: { status: 'cancelled' } }),
			evacuee({ _id: 'evacuee:hidden', privacy: { search_excluded: true } })
		];

		expect(groupPhoneMatches(docs, 'SH001', new Map())).toEqual([]);
	});
});
