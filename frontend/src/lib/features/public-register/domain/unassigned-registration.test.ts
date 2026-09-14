/**
 * Domain unit tests — Unassigned Registration mapper from UnifiedRegistrationInput (#255).
 */
import { describe, expect, it } from 'vitest';
import {
	publicUnassignedRegistrationRequestSchema,
	toUnassignedRegistrationPayload
} from './unassigned-registration';
import type { UnifiedRegistrationInput } from '$lib/features/people/server';

function sampleUnified(over: Partial<UnifiedRegistrationInput> = {}): UnifiedRegistrationInput {
	return {
		members: [
			{
				first_name: 'สมชาย',
				last_name: 'ใจดี',
				gender: 'male',
				phone: '0812345678',
				nickname: 'ชาย',
				religion: 'buddhist',
				person_id: { cardType: 'national_id', number: '1234567890123' },
				country: 'THAILAND',
				vulnerable_groups: ['elderly'],
				special_needs: ['wheelchair'],
				emergency_contact: { name: 'สมหญิง', phone: '0899999999', relation: 'คู่สมรส' },
				photo: 'gfs:507f1f77bcf86cd799439011',
				medical_conditions: [],
				medical_allergies: [],
				medical_medications: []
			}
		],
		household: {
			housing_type: 'owned_house',
			residence_landmark: null,
			address_no: '123/45',
			village_no: 'หมู่ 4',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110',
			pets: [
				{
					species: 'dog',
					count: 1,
					has_cage: true,
					image_url: 'gfs:507f1f77bcf86cd799439012'
				}
			],
			vehicles: [],
			assets: null
		},
		...over
	};
}

describe('publicUnassignedRegistrationRequestSchema', () => {
	it('accepts UnifiedRegistrationInput + captcha/disclaimer meta', () => {
		const parsed = publicUnassignedRegistrationRequestSchema.parse({
			...sampleUnified(),
			captchaToken: 'tok',
			disclaimerAcknowledged: true
		});
		expect(parsed.members).toHaveLength(1);
		expect(parsed.disclaimerAcknowledged).toBe(true);
	});

	it('rejects empty members', () => {
		expect(
			publicUnassignedRegistrationRequestSchema.safeParse({
				...sampleUnified(),
				members: []
			}).success
		).toBe(false);
	});

	it('requires primary contact phone', () => {
		const input = sampleUnified();
		input.members[0]!.phone = '';
		expect(publicUnassignedRegistrationRequestSchema.safeParse(input).success).toBe(false);
	});
});

describe('toUnassignedRegistrationPayload', () => {
	it('maps unified fields including emergency_contact, nickname, religion, photo', () => {
		const payload = toUnassignedRegistrationPayload(sampleUnified());
		expect(payload.registered_via).toBe('web');
		expect(payload.members[0]).toMatchObject({
			first_name: 'สมชาย',
			phone: '0812345678',
			nickname: 'ชาย',
			religion: 'buddhist',
			photo: 'gfs:507f1f77bcf86cd799439011',
			emergency_contact: { name: 'สมหญิง', phone: '0899999999', relation: 'คู่สมรส' },
			vulnerable_groups: ['elderly'],
			special_needs: ['wheelchair']
		});
		expect(payload.household.address_no).toBe('123/45');
		expect(payload.household.province).toBe('สงขลา');
		expect(payload.household.pets?.[0]).toMatchObject({
			species: 'dog',
			has_cage: true,
			image_url: 'gfs:507f1f77bcf86cd799439012'
		});
	});

	it('omits blank emergency_contact', () => {
		const input = sampleUnified();
		input.members[0]!.emergency_contact = { name: '', phone: '', relation: '' };
		const payload = toUnassignedRegistrationPayload(input);
		expect(payload.members[0].emergency_contact).toBeUndefined();
	});

	it('supports anonymous cardType', () => {
		const input = sampleUnified();
		input.members[0]!.person_id = {
			cardType: 'anonymous',
			number: 'ANON-01HTEST000000000000000000'
		};
		const payload = toUnassignedRegistrationPayload(input);
		expect(payload.members[0].person_id).toEqual({
			cardType: 'anonymous',
			number: 'ANON-01HTEST000000000000000000'
		});
	});
});
