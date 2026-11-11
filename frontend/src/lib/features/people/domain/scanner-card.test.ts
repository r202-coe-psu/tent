import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	applyCardAddressToHousehold,
	applyScannedCard,
	cardToUnifiedMember,
	type ScannerCard
} from './scanner-card';
import { blankUnifiedMember, type UnifiedHouseholdInput } from './unified-registration';

function card(over: Partial<ScannerCard> = {}): ScannerCard {
	return {
		citizen_id: '1234567890121',
		first_name_th: 'สมชาย',
		last_name_th: 'ใจดี',
		gender: 'male',
		...over
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('cardToUnifiedMember demographics', () => {
	it('maps the card gender and its CE birth year to gender and Buddhist-Era birth year', () => {
		const member = cardToUnifiedMember(
			card({ gender: 'female', birth_year_ce: 1992, age: 33 }),
			blankUnifiedMember()
		);

		expect(member.gender).toBe('female');
		expect(member.birth_year).toBe(2535);
		expect(member.age).toBe(33);
	});

	it('derives the age from the Buddhist-Era birth year when the card carries no age', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-11-11T00:00:00Z'));

		const member = cardToUnifiedMember(card({ birth_year_ce: 1992 }), blankUnifiedMember());

		expect(member.birth_year).toBe(2535);
		expect(member.age).toBe(34);
	});

	it('leaves the birth year and age unchanged when the card has no birth year', () => {
		const base = { ...blankUnifiedMember(), birth_year: 2540, age: 29 };

		const member = cardToUnifiedMember(card({ gender: 'other' }), base);

		expect(member.gender).toBe('other');
		expect(member.birth_year).toBe(2540);
		expect(member.age).toBe(29);
	});
});

const blankHousehold: UnifiedHouseholdInput = {
	housing_type: 'owned_house',
	residence_landmark: null,
	address_no: '',
	village_no: '',
	subdistrict: '',
	district: '',
	province: '',
	postal_code: '',
	pets: [],
	vehicles: [],
	assets: null
};

describe('applyCardAddressToHousehold', () => {
	const addressCard = card({
		address_no: '99/1',
		village_no: '3',
		lane: 'ซอย 5',
		road: 'ถ.เพชรเกษม',
		subdistrict: 'ตำบลในเมือง',
		district: 'อำเภอเมือง',
		province: 'จังหวัดขอนแก่น'
	});

	it('fills an empty household address from the card, folding lane and road into the village line and dropping area prefixes', () => {
		const household = applyCardAddressToHousehold(blankHousehold, addressCard);

		expect(household.address_no).toBe('99/1');
		expect(household.village_no).toBe('3 ซอย 5 ถ.เพชรเกษม');
		expect(household.subdistrict).toBe('ในเมือง');
		expect(household.district).toBe('เมือง');
		expect(household.province).toBe('ขอนแก่น');
	});

	it('leaves a household that already has an address unchanged', () => {
		const typed = { ...blankHousehold, address_no: '12', province: 'เชียงใหม่' };

		const household = applyCardAddressToHousehold(typed, addressCard);

		expect(household).toEqual(typed);
	});
});

describe('applyScannedCard', () => {
	const named = (first_name: string) => ({ ...blankUnifiedMember(), first_name });
	const withId = (number: string) => ({
		...blankUnifiedMember(),
		person_id: { cardType: 'national_id' as const, number }
	});

	it('fills the first empty member', () => {
		const members = [named('สมหญิง'), blankUnifiedMember(), blankUnifiedMember()];

		expect(applyScannedCard(members, card())).toEqual({ kind: 'fill', index: 1 });
	});

	it('does not treat a member with only an ID number as empty', () => {
		const members = [withId('9999999999999'), blankUnifiedMember()];

		expect(applyScannedCard(members, card())).toEqual({ kind: 'fill', index: 1 });
	});

	it('reports the member that already has this citizen ID, ignoring spaces and dashes', () => {
		const members = [named('สมหญิง'), withId('1-2345-67890-12-1'), blankUnifiedMember()];

		expect(applyScannedCard(members, card({ citizen_id: '1234567890121' }))).toEqual({
			kind: 'already-in-form',
			index: 1
		});
	});

	it('checks for the same citizen ID before looking for an empty slot', () => {
		const members = [blankUnifiedMember(), withId('1234567890121')];

		expect(applyScannedCard(members, card())).toEqual({ kind: 'already-in-form', index: 1 });
	});

	it('asks to overwrite when no member is empty', () => {
		const members = [named('สมหญิง'), withId('9999999999999')];

		expect(applyScannedCard(members, card())).toEqual({ kind: 'ask-overwrite' });
	});
});
