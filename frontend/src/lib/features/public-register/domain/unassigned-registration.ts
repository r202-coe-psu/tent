/**
 * Public Unassigned Registration create — CR-113.
 *
 * Shelter-unknown Public Pre-registration. Persists only via FastAPI → Mongo
 * `unassigned_registrations`. No Couch Evacuee / no Forecast seat until claim.
 *
 * Pure: no I/O, no Svelte. Safe to import from `+server.ts`.
 */
import { z } from 'zod';
import {
	bookingGenderSchema,
	bookingPhoneSchema,
	publicBookingAddressSchema,
	publicBookingPetSchema
} from './booking';

const cardTypeSchema = z.enum(['national_id', 'passport', 'pink_card', 'other', 'anonymous']);

export const unassignedPersonIdSchema = z.object({
	cardType: cardTypeSchema.default('national_id'),
	number: z.string().trim().min(1).max(64).optional()
});

export const unassignedMemberInputSchema = z.object({
	first_name: z
		.string({ error: 'กรุณากรอกชื่อ' })
		.trim()
		.min(1, 'กรุณากรอกชื่อ')
		.max(100, 'ชื่อยาวเกินไป'),
	last_name: z.string().trim().max(100, 'นามสกุลยาวเกินไป').default(''),
	gender: bookingGenderSchema,
	phone: bookingPhoneSchema.optional().nullable(),
	person_id: unassignedPersonIdSchema.optional(),
	country: z.string().trim().min(1).max(100).default('THAILAND'),
	vulnerable_groups: z.array(z.string().trim().min(1)).max(20).default([]),
	special_needs: z.array(z.string().trim().min(1)).max(20).default([]),
	birth_year: z.number().int().optional(),
	age: z.number().int().min(0).max(150).optional()
});

export const housingTypeSchema = z.enum([
	'owned_house',
	'rented_house',
	'condo',
	'apartment_dorm',
	'homeless'
]);

/**
 * Household block for Unassigned Registration — CR-112 housing + domicile address
 * + pets. `address` fields are flattened onto the FastAPI `household` object.
 */
export const unassignedHouseholdInputSchema = z
	.object({
		housing_type: housingTypeSchema.optional().nullable(),
		residence_landmark: z.string().trim().max(200).optional().nullable(),
		address: publicBookingAddressSchema.optional(),
		pets: z.array(publicBookingPetSchema).max(20).default([])
	})
	.superRefine((value, ctx) => {
		if (value.housing_type === 'homeless') {
			const landmark = value.residence_landmark?.trim();
			const geoComplete =
				Boolean(value.address?.province?.trim()) &&
				Boolean(value.address?.district?.trim()) &&
				Boolean(value.address?.subdistrict?.trim());
			if (!landmark && !geoComplete) {
				ctx.addIssue({
					code: 'custom',
					message: 'ที่พักแบบไร้บ้านเลขที่ต้องมีจุดสังเกตหรือที่ตั้งครบ',
					path: ['residence_landmark']
				});
			}
			return;
		}
		if (!value.address) {
			ctx.addIssue({
				code: 'custom',
				message: 'กรุณากรอกที่อยู่',
				path: ['address']
			});
		}
	});

export const unassignedRegistrationInputSchema = z
	.object({
		members: z
			.array(unassignedMemberInputSchema)
			.min(1, 'ต้องมีผู้เข้าพักอย่างน้อย 1 คน')
			.max(20, 'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง'),
		household: unassignedHouseholdInputSchema,
		/** Contact phone when not set per-member — applied to members[0] before FastAPI. */
		phone: bookingPhoneSchema.optional(),
		captchaToken: z.string().trim().optional()
	})
	.superRefine((value, ctx) => {
		const headPhone = value.phone ?? value.members[0]?.phone;
		if (!headPhone) {
			ctx.addIssue({
				code: 'custom',
				message: 'กรุณากรอกเบอร์โทรศัพท์',
				path: ['phone']
			});
		}
	});

export type UnassignedRegistrationInput = z.infer<typeof unassignedRegistrationInputSchema>;

/** Shape FastAPI `POST /public/v1/unassigned-registrations` expects. */
export function toUnassignedRegistrationPayload(input: UnassignedRegistrationInput) {
	const members = input.members.map((member, index) => {
		const phone = member.phone ?? (index === 0 && input.phone ? input.phone : null) ?? null;
		return {
			first_name: member.first_name,
			last_name: member.last_name,
			gender: member.gender,
			phone,
			...(member.person_id ? { person_id: member.person_id } : {}),
			country: member.country,
			vulnerable_groups: member.vulnerable_groups,
			special_needs: member.special_needs,
			...(member.birth_year !== undefined ? { birth_year: member.birth_year } : {}),
			...(member.age !== undefined ? { age: member.age } : {})
		};
	});

	const address = input.household.address;
	return {
		members,
		household: {
			housing_type: input.household.housing_type ?? null,
			residence_landmark: input.household.residence_landmark ?? null,
			address_no: address?.address_no ?? null,
			village_no: address?.village_no || null,
			subdistrict: address?.subdistrict ?? null,
			district: address?.district ?? null,
			province: address?.province ?? null,
			postal_code: address?.postal_code || null,
			pets: input.household.pets.map((pet) => {
				const isKnown = pet.species === 'dog' || pet.species === 'cat' || pet.species === 'other';
				const species = (isKnown ? pet.species : 'other') as 'dog' | 'cat' | 'other';
				const rawNotes = [pet.name, pet.condition, pet.notes]
					.map((s) => s?.trim())
					.filter(Boolean)
					.join(' | ');
				return {
					species,
					count: 1,
					...(rawNotes ? { notes: rawNotes } : {}),
					has_cage: pet.has_cage
				};
			})
		},
		registered_via: 'web' as const
	};
}

export type UnassignedRegistrationErrorCode =
	| 'INVALID_INPUT'
	| 'RATE_LIMITED'
	| 'CAPTCHA_REQUIRED'
	| 'CAPTCHA_FAILED'
	| 'SERVER_MISCONFIGURED'
	| 'DUPLICATE_OPEN_IDENTITY'
	| 'WRITE_FAILED';

export function unassignedRegistrationErrorMessage(code: string | undefined): string {
	switch (code) {
		case 'DUPLICATE_OPEN_IDENTITY':
			return 'มีผู้ลงทะเบียนด้วยบัตรหรือเบอร์นี้อยู่แล้วในคิวกลาง';
		case 'RATE_LIMITED':
			return 'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่';
		case 'CAPTCHA_REQUIRED':
		case 'CAPTCHA_FAILED':
			return 'การยืนยันตัวตนไม่สำเร็จ กรุณาลองใหม่';
		case 'INVALID_INPUT':
			return 'ข้อมูลไม่ครบหรือไม่ถูกต้อง';
		default:
			return 'ไม่สามารถบันทึกการลงทะเบียนได้ กรุณาลองใหม่';
	}
}
