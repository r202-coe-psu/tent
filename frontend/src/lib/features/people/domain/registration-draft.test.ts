import { describe, expect, it } from 'vitest';
import {
	REGISTRATION_DRAFT_MAX_AGE_MS,
	fromRegistrationDraft,
	hasRegistrationDraftContent,
	toRegistrationDraft
} from './registration-draft';
import { blankUnifiedMember, type UnifiedRegistrationInput } from './unified-registration';

const NOW = Date.parse('2026-11-06T10:00:00.000Z');

const household = {
	housing_type: 'owned_house',
	address_no: '12',
	subdistrict: 'คอหงส์',
	pets: [{ species: 'dog', count: 1, image_url: 'https://img/pet.jpg' }],
	assets: { description: 'มอเตอร์ไซค์', image_url: 'https://img/bike.jpg' }
} as unknown as UnifiedRegistrationInput['household'];

const member = {
	...blankUnifiedMember(),
	form_key: 'm1',
	first_name: 'สมชาย',
	phone: '0812345678',
	person_id: { cardType: 'national_id' as const, number: '1100000000001' },
	photo: 'image:01ABC'
};

describe('registration draft (#358)', () => {
	it('keeps what was typed and leaves the photos out', () => {
		const draft = toRegistrationDraft(household, [member], NOW);
		expect(draft).toMatchObject({ v: 1, saved_at: NOW });
		expect(draft.members[0]).toMatchObject({ first_name: 'สมชาย', phone: '0812345678' });
		expect(draft.members[0].photo).toBeNull();
		expect(draft.household.pets?.[0]).toMatchObject({ species: 'dog', image_url: null });
		expect(draft.household.assets).toMatchObject({ description: 'มอเตอร์ไซค์', image_url: null });
		expect(draft.household.address_no).toBe('12');
	});

	it('restores a fresh draft, filling default household fields and laying members over blanks', () => {
		const stored = JSON.parse(JSON.stringify(toRegistrationDraft(household, [member], NOW)));
		delete stored.members[0].special_needs;
		delete stored.household.province;
		delete stored.household.vehicles;
		const restored = fromRegistrationDraft(stored, NOW + 60_000)!;
		expect(restored.household.subdistrict).toBe('คอหงส์');
		expect(restored.household.province).toBe('');
		expect(restored.household.vehicles).toEqual([]);
		expect(restored.household.assets).toMatchObject({
			description: 'มอเตอร์ไซค์',
			image_url: null
		});
		expect(restored.members[0]).toMatchObject({ form_key: 'm1', first_name: 'สมชาย' });
		expect(restored.members[0].special_needs).toEqual([]);
		expect(restored.members[0].photo).toBeNull();
	});

	it.each([
		['too old', { v: 1, saved_at: NOW - REGISTRATION_DRAFT_MAX_AGE_MS - 1 }],
		['from the future', { v: 1, saved_at: NOW + 1 }],
		['another version', { v: 2, saved_at: NOW }],
		['without members', { v: 1, saved_at: NOW, members: [] }],
		['with a broken member', { v: 1, saved_at: NOW, members: ['x'] }],
		['without a household', { v: 1, saved_at: NOW, household: null }]
	])('drops a draft %s', (_label, over) => {
		const stored = { ...toRegistrationDraft(household, [member], NOW), ...over };
		expect(fromRegistrationDraft(stored, NOW)).toBeNull();
	});

	it('drops anything that is not a draft', () => {
		expect(fromRegistrationDraft(null, NOW)).toBeNull();
		expect(fromRegistrationDraft('text', NOW)).toBeNull();
		expect(fromRegistrationDraft([], NOW)).toBeNull();
	});

	it('detects whether a draft or form state has meaningful user-entered content', () => {
		expect(hasRegistrationDraftContent({ household: {}, members: [] })).toBe(false);
		expect(
			hasRegistrationDraftContent({
				household: {},
				members: [blankUnifiedMember()]
			})
		).toBe(false);

		expect(
			hasRegistrationDraftContent({
				household: {},
				members: [{ ...blankUnifiedMember(), first_name: 'มีนา' }]
			})
		).toBe(true);

		expect(
			hasRegistrationDraftContent({
				household: { address_no: '12/34' },
				members: [blankUnifiedMember()]
			})
		).toBe(true);
	});
});
