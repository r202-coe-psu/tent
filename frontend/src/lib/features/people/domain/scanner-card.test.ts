import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyCardAddressToHousehold, cardToUnifiedMember, type ScannerCard } from './scanner-card';
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
