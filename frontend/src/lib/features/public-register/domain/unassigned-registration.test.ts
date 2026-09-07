/**
 * Domain unit tests — Unassigned Registration create payload (CR-113).
 */
import { describe, expect, it } from 'vitest';
import {
	toUnassignedRegistrationPayload,
	unassignedRegistrationInputSchema
} from './unassigned-registration';

const ADDRESS = {
	address_no: '123/45',
	village_no: 'หมู่ 4',
	subdistrict: 'คอหงส์',
	district: 'หาดใหญ่',
	province: 'สงขลา',
	postal_code: '90110'
};

const VALID = {
	phone: '0812345678',
	members: [
		{
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male' as const,
			person_id: { cardType: 'national_id' as const, number: '1234567890123' },
			special_needs: [],
			vulnerable_groups: []
		}
	],
	household: {
		housing_type: 'owned_house' as const,
		address: ADDRESS,
		pets: []
	},
	captchaToken: 'tok'
};

describe('unassignedRegistrationInputSchema', () => {
	it('accepts a shelter-unknown household with domicile address', () => {
		const parsed = unassignedRegistrationInputSchema.parse(VALID);
		expect(parsed.members).toHaveLength(1);
		expect(parsed.household.housing_type).toBe('owned_house');
	});

	it('rejects empty members', () => {
		expect(unassignedRegistrationInputSchema.safeParse({ ...VALID, members: [] }).success).toBe(
			false
		);
	});

	it('allows homeless without address_no when landmark is set', () => {
		const parsed = unassignedRegistrationInputSchema.parse({
			...VALID,
			household: {
				housing_type: 'homeless',
				residence_landmark: 'ใต้สะพาน',
				pets: []
			}
		});
		expect(parsed.household.residence_landmark).toBe('ใต้สะพาน');
	});
});

describe('toUnassignedRegistrationPayload', () => {
	it('forces registered_via web and applies contact phone to head', () => {
		const input = unassignedRegistrationInputSchema.parse(VALID);
		const payload = toUnassignedRegistrationPayload(input);
		expect(payload.registered_via).toBe('web');
		expect(payload.members[0].phone).toBe('0812345678');
		expect(payload.household.address_no).toBe('123/45');
		expect(payload.household.province).toBe('สงขลา');
	});
});
