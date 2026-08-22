/**
 * Public booking domain — CR-070 / T-71.
 *
 * The citizen-facing shape of a self-service shelter booking: one household plus
 * one `evacuee` per member. Deliberately much narrower than staff intake — only
 * the T-48 minimum plus what the shelter itself needs to allocate space. Medical
 * details are collected by staff at the gate (T-49), never here.
 *
 * `phone` is mandatory because D-BOOK-TOKEN=A makes it the second factor for
 * self-lookup; only the household contact has one, members do not.
 *
 * Pure: no I/O, no Svelte, no CouchDB. Safe to import from `+server.ts`.
 */
import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';

/**
 * The shelter the citizen picked, validated against the shared
 * {@link shelterCodeSchema} but reported in Thai.
 *
 * The shared schema's message ("Shelter code must look like SH001") is a
 * developer-facing assertion about a code the *staff* UI never types by hand —
 * on a public form the only way to fail it is to submit without choosing a
 * shelter, and an English format error is the wrong thing to show for that.
 * Wrapped rather than edited: the same schema guards every staff-plane doc id.
 */
export const bookingShelterCodeSchema = z
	.string({ error: 'กรุณาเลือกศูนย์พักพิง' })
	.trim()
	.min(1, 'กรุณาเลือกศูนย์พักพิง')
	.refine((code) => shelterCodeSchema.safeParse(code).success, 'กรุณาเลือกศูนย์พักพิงจากรายการ');

/** Thai mobile number, digits only. Unlike staff intake, "ไม่มี" is not an option. */
export const bookingPhoneSchema = z
	.string({ error: 'กรุณากรอกเบอร์โทรศัพท์' })
	.trim()
	.regex(/^\d{10}$/, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก');

export const bookingGenderSchema = z.enum(['male', 'female', 'other'], {
	error: 'กรุณาเลือกเพศ'
});

/** 13-digit Thai national ID. Optional — a displaced person may have lost their card. */
export const bookingNationalIdSchema = z
	.string()
	.trim()
	.regex(/^\d{13}$/, 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก');

/**
 * One person on the booking. `member[0]` is the household contact.
 *
 * `first_name`/`last_name` are separate fields — same split staff intake uses
 * (`evacueeInputSchema`, `evacuee-registration.svelte`) — rather than one free-text
 * "ชื่อ-นามสกุล" box, since `createEvacuee` requires both non-empty and a single-word
 * entry has no whitespace to split on.
 *
 * `special_needs` holds the labels the citizen ticked, drawn from the selected
 * shelter's `admission_policy.supported_vulnerable_groups` — the shelter decides
 * which groups it can take, so the choices are per-shelter rather than a fixed
 * list here. Stored straight into `evacuee.special_needs`, which has been
 * free-form `[str]` since CR-046.
 */
export const publicBookingMemberSchema = z.object({
	first_name: z
		.string({ error: 'กรุณากรอกชื่อ' })
		.trim()
		.min(1, 'กรุณากรอกชื่อ')
		.max(100, 'ชื่อยาวเกินไป'),
	last_name: z
		.string({ error: 'กรุณากรอกนามสกุล' })
		.trim()
		.min(1, 'กรุณากรอกนามสกุล')
		.max(100, 'นามสกุลยาวเกินไป'),
	gender: bookingGenderSchema,
	special_needs: z.array(z.string().trim().min(1)).max(20, 'เลือกได้สูงสุด 20 รายการ').default([])
});

export type PublicBookingMember = z.infer<typeof publicBookingMemberSchema>;

/**
 * A pet's species, as a `master_data:pet_types` item `code` (CR-010 phase 2)
 * rather than a fixed enum — shelters configure their own accepted species via
 * master data (global list plus per-shelter overrides), so the wire format is
 * "whatever code `/api/public/v1/config/pet-types` offered" and not a closed
 * set of literals known at compile time. Still bounded and non-empty so a
 * malformed or oversized value cannot slip through — just not tied to the
 * master-data `code` regex, which is an implementation detail of that feature.
 */
export const publicBookingPetSpeciesSchema = z
	.string({ error: 'กรุณาเลือกชนิดสัตว์เลี้ยง' })
	.trim()
	.min(1, 'กรุณาเลือกชนิดสัตว์เลี้ยง')
	.max(40, 'รหัสชนิดสัตว์เลี้ยงยาวเกินไป');

/** A pet travelling with the household — mirrors `household.pets[]` (CR-016). */
export const publicBookingPetSchema = z.object({
	species: publicBookingPetSpeciesSchema,
	notes: z.string().trim().max(200, 'รายละเอียดยาวเกินไป').optional(),
	has_cage: z.boolean().default(false)
});

/**
 * A vehicle the household drives to the shelter — mirrors `household.vehicles[]`
 * (people domain, schema_v 4), so the citizen-entered value lands in the field
 * staff already read on the household profile. Kept to the same closed enum:
 * unlike pet species (master-data driven, CR-049), vehicle type is still a fixed
 * set in the household schema and this form must not widen it unilaterally.
 *
 * `license_plate` is optional — the plate is what lets staff manage parking, but
 * a citizen fleeing at night may not have it to hand, and the household schema
 * already stores it nullable.
 */
export const publicBookingVehicleTypeSchema = z.enum(['car', 'motorcycle', 'other'], {
	error: 'กรุณาเลือกประเภทยานพาหนะ'
});

export const publicBookingVehicleSchema = z.object({
	type: publicBookingVehicleTypeSchema,
	license_plate: z.string().trim().max(20, 'ทะเบียนรถยาวเกินไป').optional()
});

export const publicBookingInputSchema = z.object({
	shelter_code: bookingShelterCodeSchema,
	phone: bookingPhoneSchema,
	national_id: bookingNationalIdSchema.optional(),
	members: z
		.array(publicBookingMemberSchema)
		.min(1, 'ต้องมีผู้เข้าพักอย่างน้อย 1 คน')
		// A single booking is a household, not a mass import — cap it so one request
		// cannot reserve an entire shelter.
		.max(20, 'จองได้สูงสุด 20 คนต่อครั้ง กรุณาติดต่อเจ้าหน้าที่หากมีมากกว่านี้'),
	pets: z.array(publicBookingPetSchema).max(20, 'ระบุสัตว์เลี้ยงได้สูงสุด 20 ตัว').default([]),
	vehicles: z.array(publicBookingVehicleSchema).max(10, 'ระบุยานพาหนะได้สูงสุด 10 คัน').default([]),
	captchaToken: z.string().trim().optional()
});

export type PublicBookingInput = z.infer<typeof publicBookingInputSchema>;

/** Household label, matching the staff pre-register convention (`ครอบครัว{ชื่อ}`). */
export function householdLabelFrom(contact: { first_name: string; last_name: string }): string {
	const joined = [contact.first_name, contact.last_name]
		.map((s) => s.trim())
		.filter(Boolean)
		.join(' ');
	return joined ? `ครอบครัว${joined}` : 'ครอบครัวผู้จองผ่านเว็บ';
}

/**
 * Map a booking onto the staff `EvacueeInput` shape, one per member.
 *
 * Fields the public form does not ask for are left to `evacueeInputSchema`'s own
 * defaults (country THAILAND, religion buddhist, …) so a web booking and a
 * counter registration produce the same doc shape. Only the household contact
 * carries the phone and the national ID — members are reachable through them.
 */
export function toEvacueeInputs(input: PublicBookingInput, householdId: string) {
	return input.members.map((member, index) => {
		const isContact = index === 0;
		return {
			first_name: member.first_name,
			last_name: member.last_name,
			gender: member.gender,
			phone: isContact ? input.phone : null,
			...(isContact && input.national_id
				? { person_id: { cardType: 'national_id' as const, number: input.national_id } }
				: {}),
			special_needs: member.special_needs,
			household_id: householdId,
			registered_via: 'web' as const
		};
	});
}

/**
 * The staff `household.pets[].species` enum (`docs/data/schema.md` §1.3, CR-016) —
 * still the pre-master-data fixed set. Wiring configured `pet_types` codes all
 * the way into that schema is CR-010 phase 2 and has not happened yet, so it is
 * a documented spec value this feature must not widen unilaterally.
 */
const LEGACY_HOUSEHOLD_PET_SPECIES = new Set(['dog', 'cat', 'bird', 'other']);

/**
 * Map a booking onto the staff `HouseholdInput` shape (CR-076: everyone gets one).
 *
 * `pet.species` is now a shelter-configured `pet_types` code (see
 * {@link publicBookingPetSpeciesSchema}), which can be anything the shelter's
 * master data offers — not necessarily one of the 4 literals the household
 * schema still accepts (CR-016, pre-dates the master-data engine). A code
 * outside that fixed set folds into `other` rather than failing `createHousehold`'s
 * validation outright; the actual configured code is preserved in `notes` so
 * staff are not left guessing what the citizen actually selected.
 *
 * `vehicles` needs no such folding — the public form offers exactly the closed
 * `car | motorcycle | other` set the household schema accepts.
 */
export function toHouseholdInput(input: PublicBookingInput, headEvacueeId: string) {
	return {
		label: householdLabelFrom(input.members[0] ?? { first_name: '', last_name: '' }),
		head_evacuee_id: headEvacueeId,
		status: 'pre_registered' as const,
		pets: input.pets.map((pet) => {
			const isKnownSpecies = LEGACY_HOUSEHOLD_PET_SPECIES.has(pet.species);
			const species = (isKnownSpecies ? pet.species : 'other') as 'dog' | 'cat' | 'bird' | 'other';
			const notes = isKnownSpecies
				? pet.notes
				: [pet.notes, `ชนิด: ${pet.species}`].filter(Boolean).join(' — ');
			return {
				species,
				count: 1,
				...(notes ? { notes } : {}),
				has_cage: pet.has_cage
			};
		}),
		// `license_plate` is nullable in the household schema, and an empty string is
		// not "no plate" — normalize the blank the form produces back to `null`.
		vehicles: input.vehicles.map((vehicle) => ({
			type: vehicle.type,
			license_plate: vehicle.license_plate?.trim() || null
		}))
	};
}

/**
 * Booking reference printed on the ticket and embedded in the QR.
 *
 * D-BOOK-TOKEN=A allows "QR **or** `official_code` + phone"; `official_code`
 * (T-50) does not exist yet, so slice 1 uses the contact's evacuee ULID — the
 * same value the staff QR already encodes, which means the gate scanner resolves
 * a web booking with no change (`lookupEvacueeByScanCode`). When T-50 lands,
 * lookup gains a second branch and must keep accepting ULIDs forever: tickets
 * already printed cannot be reissued.
 */
export function bookingCodeFrom(evacueeId: string): string {
	return evacueeId.startsWith('evacuee:') ? evacueeId.slice('evacuee:'.length) : evacueeId;
}

/** Inverse of {@link bookingCodeFrom} — accepts a bare ULID or a full doc id. */
export function evacueeIdFromBookingCode(code: string): string {
	const trimmed = code.trim().toUpperCase();
	return trimmed.startsWith('EVACUEE:')
		? `evacuee:${trimmed.slice('EVACUEE:'.length)}`
		: `evacuee:${trimmed}`;
}

/**
 * Placeholder values that ship in `.env.example` / test fixtures. Treating them
 * as "configured" is what makes the wizard dead-end locally: reCAPTCHA loads,
 * `execute()` rejects the fake site key, and the citizen sees a verification
 * error for a form that was never going to submit.
 */
const CAPTCHA_PLACEHOLDER_KEYS = new Set([
	'dummy-secret',
	'google_site_key',
	'google_secret_key',
	'change-me-in-staging'
]);

/**
 * Is a real reCAPTCHA key configured?
 *
 * Used on both planes — the browser checks `PUBLIC_RECAPTCHA_SITE_KEY` before
 * loading Google's script, the BFF checks `SECRET_RECAPTCHA_KEY` before
 * verifying. `false` means "captcha cannot run here", which the BFF only honours
 * in dev; production fails closed instead.
 */
export function isCaptchaKeyConfigured(key: string | undefined | null): boolean {
	const trimmed = (key ?? '').trim();
	return trimmed.length > 0 && !CAPTCHA_PLACEHOLDER_KEYS.has(trimmed);
}

export const publicBookingLookupSchema = z.object({
	code: z.string({ error: 'กรุณากรอกรหัสการจอง' }).trim().min(1, 'กรุณากรอกรหัสการจอง').max(64),
	phone: bookingPhoneSchema
});

export type PublicBookingLookupInput = z.infer<typeof publicBookingLookupSchema>;

/** Server error codes the form maps to Thai copy. */
export type PublicBookingErrorCode =
	| 'RATE_LIMITED'
	| 'CAPTCHA_REQUIRED'
	| 'CAPTCHA_FAILED'
	| 'SHELTER_NOT_FOUND'
	| 'SHELTER_CLOSED'
	| 'BOOKING_NOT_FOUND'
	| 'WRITE_FAILED';

const ERROR_COPY: Record<PublicBookingErrorCode, string> = {
	RATE_LIMITED: 'มีการส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
	CAPTCHA_REQUIRED: 'ไม่สามารถยืนยันว่าไม่ใช่บอทได้ กรุณารีเฟรชหน้าแล้วลองใหม่',
	CAPTCHA_FAILED: 'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่',
	SHELTER_NOT_FOUND: 'ไม่พบศูนย์พักพิงที่เลือก กรุณาเลือกใหม่',
	SHELTER_CLOSED: 'ศูนย์พักพิงนี้ปิดรับผู้เข้าพักแล้ว กรุณาเลือกศูนย์อื่น',
	BOOKING_NOT_FOUND: 'ไม่พบการจองที่ตรงกับรหัสและเบอร์โทรนี้',
	WRITE_FAILED: 'บันทึกการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
};

export function publicBookingErrorMessage(code: unknown): string {
	if (typeof code === 'string' && code in ERROR_COPY) {
		return ERROR_COPY[code as PublicBookingErrorCode];
	}
	return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}
