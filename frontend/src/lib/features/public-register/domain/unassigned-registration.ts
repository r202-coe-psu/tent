/**
 * Public Unassigned Registration — CR-113 / #255.
 *
 * Shelter-unknown Public Pre-registration. Persists only via FastAPI → Mongo
 * `unassigned_registrations`. No Couch Evacuee / no Forecast seat until claim.
 *
 * Single input path: `UnifiedRegistrationInput` (+ captcha/meta). Do NOT keep a
 * parallel ad-hoc Zod member/household schema — map from the shared unified form.
 *
 * Pure: no I/O, no Svelte. Safe to import from `+server.ts`.
 */
import { z } from 'zod';
import type { components } from '$lib/api/openapi';
import {
	isBlankEmergencyContact,
	unifiedRegistrationInputSchema,
	type UnifiedRegistrationInput,
	type UnifiedRegistrationParsed
} from '$lib/features/people/server';

/** FastAPI create body — derived from OpenAPI (CONVENTIONS §12). */
export type UnassignedRegistrationPayload =
	components['schemas']['UnassignedRegistrationCreateRequest'];

/**
 * BFF request body for POST /api/public/v1/unassigned-registrations.
 * Primary shape = UnifiedRegistrationInput + captcha / disclaimer meta.
 */
export const publicUnassignedRegistrationRequestSchema = z
	.object({
		members: unifiedRegistrationInputSchema.shape.members,
		household: unifiedRegistrationInputSchema.shape.household,
		captchaToken: z.string().trim().optional(),
		disclaimerAcknowledged: z.boolean().optional()
	})
	.superRefine((value, ctx) => {
		const headPhone = value.members[0]?.phone?.trim();
		if (!headPhone || !/^0\d{8,9}$/.test(headPhone.replace(/[-\s]/g, ''))) {
			ctx.addIssue({
				code: 'custom',
				path: ['members', 0, 'phone'],
				message: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก'
			});
		}
	});

export type PublicUnassignedRegistrationRequest = z.input<
	typeof publicUnassignedRegistrationRequestSchema
>;

/** @deprecated Prefer {@link publicUnassignedRegistrationRequestSchema} — alias for tests/BFF. */
export const unassignedRegistrationInputSchema = publicUnassignedRegistrationRequestSchema;
export type UnassignedRegistrationInput = PublicUnassignedRegistrationRequest;

function omitBlankEmergency(
	contact: UnifiedRegistrationParsed['members'][number]['emergency_contact']
): { name: string; phone: string; relation: string } | undefined {
	if (contact == null || isBlankEmergencyContact(contact)) return undefined;
	return {
		name: contact.name.trim(),
		phone: contact.phone.trim(),
		relation: contact.relation.trim()
	};
}

/**
 * Map shared UnifiedRegistrationInput → FastAPI create body.
 * Public channel: vehicles/assets are not collected (cleared by the form).
 * Medical fields are out of scope for the Mongo queue (#255).
 */
export function toUnassignedRegistrationPayload(
	input: UnifiedRegistrationInput | UnifiedRegistrationParsed
): UnassignedRegistrationPayload {
	const parsed =
		'pets' in (input.household ?? {})
			? unifiedRegistrationInputSchema.parse(input)
			: (input as UnifiedRegistrationParsed);

	const members = parsed.members.map((member, index) => {
		const rawPhone = member.phone?.trim();
		const phone =
			rawPhone || (index === 0 ? parsed.members[0]?.phone?.trim() || null : null) || null;
		const cardType = member.person_id?.cardType;
		const person_id =
			cardType === 'anonymous'
				? {
						cardType: 'anonymous' as const,
						...(member.person_id?.number?.trim() ? { number: member.person_id.number.trim() } : {})
					}
				: cardType && member.person_id?.number?.trim()
					? { cardType, number: member.person_id.number.trim() }
					: undefined;
		const emergency = omitBlankEmergency(member.emergency_contact);
		const nickname = member.nickname?.trim() || null;
		const religion =
			member.religion && member.religion !== 'unknown' ? member.religion : member.religion || null;
		const photo = member.photo?.trim() || null;

		return {
			first_name: member.first_name,
			last_name: member.last_name ?? '',
			gender: member.gender,
			phone,
			...(person_id ? { person_id } : {}),
			country: member.country ?? 'THAILAND',
			vulnerable_groups: member.vulnerable_groups ?? [],
			special_needs: member.special_needs ?? [],
			...(typeof member.birth_year === 'number' ? { birth_year: member.birth_year } : {}),
			...(typeof member.age === 'number' ? { age: member.age } : {}),
			...(nickname ? { nickname } : {}),
			...(religion ? { religion } : {}),
			...(emergency ? { emergency_contact: emergency } : {}),
			...(photo ? { photo } : {})
		};
	});

	const hh = parsed.household;
	return {
		members,
		household: {
			housing_type: hh.housing_type ?? null,
			residence_landmark: hh.residence_landmark ?? null,
			address_no: hh.housing_type === 'homeless' ? null : (hh.address_no ?? null),
			village_no: hh.village_no || null,
			subdistrict: hh.subdistrict ?? null,
			district: hh.district ?? null,
			province: hh.province ?? null,
			postal_code: hh.postal_code || null,
			pets: (hh.pets ?? []).map((pet) => {
				const isKnown = pet.species === 'dog' || pet.species === 'cat' || pet.species === 'other';
				const species = (isKnown ? pet.species : 'other') as 'dog' | 'cat' | 'other';
				const notes = pet.notes?.trim();
				const imageUrl = pet.image_url?.trim() || null;
				return {
					species,
					count: Number(pet.count) || 1,
					...(notes ? { notes } : {}),
					has_cage: pet.has_cage ?? false,
					...(imageUrl ? { image_url: imageUrl } : {})
				};
			})
		},
		registered_via: 'web'
	};
}

export type UnassignedRegistrationErrorCode =
	| 'INVALID_INPUT'
	| 'INVALID_ANONYMOUS_ID'
	| 'INVALID_PHOTO_REF'
	| 'RATE_LIMITED'
	| 'CAPTCHA_REQUIRED'
	| 'CAPTCHA_FAILED'
	| 'SERVER_MISCONFIGURED'
	| 'DUPLICATE_OPEN_IDENTITY'
	| 'WRITE_FAILED'
	| 'DISCLAIMER_REQUIRED';

export function unassignedRegistrationErrorMessage(code: string | undefined): string {
	switch (code) {
		case 'DUPLICATE_OPEN_IDENTITY':
			return 'มีผู้ลงทะเบียนด้วยบัตรหรือเบอร์นี้อยู่แล้วในคิวกลาง';
		case 'INVALID_ANONYMOUS_ID':
			return 'รหัสนิรนามไม่ถูกต้อง';
		case 'INVALID_PHOTO_REF':
			return 'รหัสรูปถ่ายไม่ถูกต้อง กรุณาอัปโหลดใหม่';
		case 'RATE_LIMITED':
			return 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
		case 'CAPTCHA_REQUIRED':
		case 'CAPTCHA_FAILED':
			return 'การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่';
		case 'DISCLAIMER_REQUIRED':
			return 'กรุณายืนยันการรับทราบเงื่อนไขการใช้งานระบบก่อนส่งข้อมูล';
		case 'INVALID_INPUT':
			return 'ข้อมูลไม่ครบหรือไม่ถูกต้อง';
		default:
			return 'ไม่สามารถบันทึกการลงทะเบียนได้ กรุณาลองใหม่';
	}
}
