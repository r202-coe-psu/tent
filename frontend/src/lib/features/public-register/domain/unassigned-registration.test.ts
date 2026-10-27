/**
 * Domain unit tests — Unassigned Registration mapper from UnifiedRegistrationInput (#255).
 */
import { describe, expect, it } from 'vitest';
import {
	publicUnassignedRegistrationRequestSchema,
	toUnassignedRegistrationPayload
} from './unassigned-registration';
import type { UnifiedRegistrationInput } from '$lib/features/people/server';
import { webConsentBody } from './public-consent.fixture';

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
				person_id: { cardType: 'national_id', number: '1234567890121' },
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
			...webConsentBody(1),
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
				...webConsentBody(1),
				members: []
			}).success
		).toBe(false);
	});

	it('requires primary contact phone when creating (no join)', () => {
		const input = sampleUnified();
		input.members[0]!.phone = '';
		expect(
			publicUnassignedRegistrationRequestSchema.safeParse({ ...input, ...webConsentBody(1) })
				.success
		).toBe(false);
	});

	it('allows empty primary phone when joining via match token', () => {
		const input = sampleUnified({ join_match_token: 'token.sig' });
		input.members[0]!.phone = '';
		expect(
			publicUnassignedRegistrationRequestSchema.safeParse({ ...input, ...webConsentBody(1) })
				.success
		).toBe(true);
	});

	it('rejects partial primary phone even when joining', () => {
		const input = sampleUnified({ join_match_token: 'token.sig' });
		input.members[0]!.phone = '08123';
		const parsed = publicUnassignedRegistrationRequestSchema.safeParse({
			...input,
			...webConsentBody(1)
		});
		expect(parsed.success).toBe(false);
	});
});

describe('toUnassignedRegistrationPayload', () => {
	it('maps unified fields including emergency_contact, nickname, religion, photo', () => {
		const payload = toUnassignedRegistrationPayload(sampleUnified(), {
			consent: webConsentBody(1)
		});
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
		const payload = toUnassignedRegistrationPayload(input, { consent: webConsentBody(1) });
		expect(payload.members[0].emergency_contact).toBeUndefined();
	});

	it('supports anonymous cardType', () => {
		const input = sampleUnified();
		input.members[0]!.person_id = {
			cardType: 'anonymous',
			number: 'ANON-01HTEST000000000000000000'
		};
		const payload = toUnassignedRegistrationPayload(input, { consent: webConsentBody(1) });
		expect(payload.members[0].person_id).toEqual({
			cardType: 'anonymous',
			number: 'ANON-01HTEST000000000000000000'
		});
	});
});

describe('public consent on the unassigned path (FR-42)', () => {
	it('rejects a request without the consent decision', () => {
		expect(publicUnassignedRegistrationRequestSchema.safeParse(sampleUnified()).success).toBe(
			false
		);
	});

	it('rejects member keys that do not line up with members', () => {
		const parsed = publicUnassignedRegistrationRequestSchema.safeParse({
			...sampleUnified(),
			...webConsentBody(2)
		});
		expect(parsed.success).toBe(false);
	});

	it('rejects a verbal recording on the web channel', () => {
		const parsed = publicUnassignedRegistrationRequestSchema.safeParse({
			...sampleUnified(),
			...webConsentBody(1, { verbal: true })
		});
		expect(parsed.success).toBe(false);
	});

	it('rejects any guardian-for member (D21)', () => {
		const parsed = publicUnassignedRegistrationRequestSchema.safeParse({
			...sampleUnified(),
			...webConsentBody(2, { guardian_for: ['m1'] })
		});
		expect(parsed.success).toBe(false);
	});

	it('rejects a basic-mode decision (D17)', () => {
		const body = webConsentBody(1);
		const parsed = publicUnassignedRegistrationRequestSchema.safeParse({
			...sampleUnified(),
			consent: {
				mode: 'basic',
				guardian_for: [],
				verbal: false,
				ref: body.consent.ref,
				given_at: body.consent.given_at,
				notice_version: body.consent.notice_version
			},
			consent_member_keys: body.consent_member_keys
		});
		expect(parsed.success).toBe(false);
	});

	it('sends an id-free grant per member and leaves channel binding to FastAPI', () => {
		const input = sampleUnified();
		input.members.push({ ...input.members[0]!, first_name: 'ลูก', phone: null, photo: null });
		const payload = toUnassignedRegistrationPayload(input, {
			consent: webConsentBody(2)
		});
		expect(payload.members.map((m) => m.consent)).toEqual([
			{
				mode: 'full',
				health: true,
				ref: 'CS-7K3QZ9MD',
				given_at: '2026-10-25T03:15:00.000Z',
				notice_version: '2026-10-25',
				given_by: 'self'
			},
			expect.objectContaining({ given_by: 'household_member' })
		]);
		expect(payload.members.map((m) => m.search_excluded)).toEqual([false, false]);
	});

	it('keeps full-mode members searchable unless search was unticked', () => {
		const visible = toUnassignedRegistrationPayload(sampleUnified(), {
			consent: webConsentBody(1)
		});
		const hidden = toUnassignedRegistrationPayload(sampleUnified(), {
			consent: webConsentBody(1, { search_visible: false })
		});
		expect(visible.members[0].search_excluded).toBe(false);
		expect(hidden.members[0].search_excluded).toBe(true);
	});
});
