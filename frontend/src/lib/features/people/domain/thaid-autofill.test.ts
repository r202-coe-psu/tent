import { describe, expect, it } from 'vitest';
import type { ThaiDAutofillProfile } from './thaid-profile';
import { blankUnifiedMember } from './unified-registration';
import { applyThaidAddressToHousehold, applyThaidProfileToMember } from './thaid-autofill';

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
