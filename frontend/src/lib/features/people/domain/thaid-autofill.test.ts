import { describe, expect, it } from 'vitest';
import type { ThaiDAutofillProfile } from './thaid-profile';
import { blankUnifiedMember } from './unified-registration';
import {
	applyThaidAddressToHousehold,
	applyThaidProfileToMember,
	applyThaidToHead,
	canScanThaidForHead
} from './thaid-autofill';

function profile(overrides: Partial<ThaiDAutofillProfile> = {}): ThaiDAutofillProfile {
	return {
		id: 'thaid-1',
		roleLabel: '',
		person_id: '1101700203451',
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		nickname: '',
		gender: 'male',
		birth_year: 2528,
		age: 41,
		phone: null,
		vulnerable_groups: [],
		special_needs: [],
		medical_conditions: [],
		address: {
			address_no: '',
			village_no: '',
			subdistrict: '',
			district: '',
			province: '',
			postal_code: ''
		},
		...overrides
	};
}

describe('applyThaidProfileToMember', () => {
	it('overwrites a mistyped last name and keeps the typed phone when ThaiD has none', () => {
		const typed = { ...blankUnifiedMember(), last_name: 'ใจดื', phone: '0812345678' };

		const filled = applyThaidProfileToMember(typed, profile());

		expect(filled.first_name).toBe('สมชาย');
		expect(filled.last_name).toBe('ใจดี');
		expect(filled.person_id).toEqual({ cardType: 'national_id', number: '1101700203451' });
		expect(filled.gender).toBe('male');
		expect(filled.birth_year).toBe(2528);
		expect(filled.phone).toBe('0812345678');
	});

	it('keeps typed values for every field ThaiD returned empty', () => {
		const typed = {
			...blankUnifiedMember(),
			nickname: 'ต้น',
			gender: 'female' as const,
			birth_year: 2533,
			age: 36,
			vulnerable_groups: ['elderly'],
			special_needs: ['wheelchair'],
			medical_conditions: ['diabetes']
		};

		const filled = applyThaidProfileToMember(
			typed,
			profile({ gender: null, birth_year: 0, age: 0 })
		);

		expect(filled.nickname).toBe('ต้น');
		expect(filled.gender).toBe('female');
		expect(filled.birth_year).toBe(2533);
		expect(filled.age).toBe(36);
		expect(filled.vulnerable_groups).toEqual(['elderly']);
		expect(filled.special_needs).toEqual(['wheelchair']);
		expect(filled.medical_conditions).toEqual(['diabetes']);
	});
});

describe('applyThaidAddressToHousehold', () => {
	it('fills the residence from ThaiD and keeps typed parts ThaiD left blank', () => {
		const typed = { housing_type: 'owned_house' as const, address_no: '9/1', postal_code: '90110' };

		const filled = applyThaidAddressToHousehold(typed, {
			address_no: '12/3',
			village_no: '4',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: ''
		});

		expect(filled).toEqual({
			housing_type: 'owned_house',
			address_no: '12/3',
			village_no: '4',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
		});
	});
});

describe('applyThaidToHead', () => {
	const thaidAddress = {
		address_no: '12/3',
		village_no: '4',
		subdistrict: 'คอหงส์',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90110'
	};
	const joinedHousehold = {
		housing_type: 'owned_house' as const,
		address_no: '99',
		village_no: '7',
		subdistrict: 'บางกล่ำ',
		district: 'บางกล่ำ',
		province: 'สงขลา',
		postal_code: '90110'
	};

	it('fills the head from ThaiD but keeps the joined household address when joining an existing household', () => {
		const next = applyThaidToHead(
			{
				members: [blankUnifiedMember()],
				household: { ...joinedHousehold, province: 'ปัตตานี' },
				hasJoinSelection: true
			},
			profile({ address: thaidAddress })
		);

		expect(next.members[0].first_name).toBe('สมชาย');
		expect(next.household.address_no).toBe('99');
		expect(next.household.subdistrict).toBe('บางกล่ำ');
		expect(next.household.province).toBe('ปัตตานี');
	});

	it('fills the household address from ThaiD when not joining an existing household', () => {
		const next = applyThaidToHead(
			{
				members: [blankUnifiedMember()],
				household: { ...joinedHousehold, address_no: '', village_no: '' },
				hasJoinSelection: false
			},
			profile({ address: thaidAddress })
		);

		expect(next.members[0].first_name).toBe('สมชาย');
		expect(next.household.address_no).toBe('12/3');
		expect(next.household.village_no).toBe('4');
		expect(next.household.subdistrict).toBe('คอหงส์');
		expect(next.household.district).toBe('หาดใหญ่');
		expect(next.household.province).toBe('สงขลา');
		expect(next.household.postal_code).toBe('90110');
	});

	it('leaves other members untouched', () => {
		const second = { ...blankUnifiedMember(), first_name: 'สมหญิง', last_name: 'ใจงาม' };

		const next = applyThaidToHead(
			{
				members: [blankUnifiedMember(), second],
				household: joinedHousehold,
				hasJoinSelection: false
			},
			profile({ address: thaidAddress })
		);

		expect(next.members).toHaveLength(2);
		expect(next.members[0].first_name).toBe('สมชาย');
		expect(next.members[1].first_name).toBe('สมหญิง');
		expect(next.members[1].last_name).toBe('ใจงาม');
	});
});

describe('canScanThaidForHead', () => {
	it.each([
		{ channel: 'onsite', mode: 'create', expected: true },
		{ channel: 'onsite', mode: 'report-in', expected: false },
		{ channel: 'public', mode: 'create', expected: true },
		{ channel: 'public', mode: 'report-in', expected: true }
	] as const)(
		'channel=$channel mode=$mode -> $expected (never lets onsite report-in overwrite an existing head)',
		({ channel, mode, expected }) => {
			expect(canScanThaidForHead({ channel, mode })).toBe(expected);
		}
	);
});
