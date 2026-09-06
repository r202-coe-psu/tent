import { describe, it, expect } from 'vitest';
import { createEvacuee, createHousehold } from '$lib/features/people/server';
import {
	bookingCodeFrom,
	evacueeIdFromBookingCode,
	householdLabelFrom,
	isCaptchaKeyConfigured,
	publicBookingErrorMessage,
	publicBookingInputSchema,
	publicBookingLookupSchema,
	publicBookingPetSpeciesSchema,
	toEvacueeInputs,
	toHouseholdInput
} from './booking';

const CONTACT = {
	first_name: '  สมชาย ',
	last_name: ' ใจดี ',
	gender: 'male' as const,
	special_needs: []
};

const ADDRESS = {
	address_no: ' 123/45 ',
	village_no: ' หมู่ 4 ',
	subdistrict: 'คอหงส์',
	district: 'หาดใหญ่',
	province: 'สงขลา',
	postal_code: '90110'
};

const VALID = {
	shelter_code: 'SH001',
	phone: '0812345678',
	address: ADDRESS,
	members: [CONTACT],
	pets: []
};

describe('publicBookingInputSchema', () => {
	it('accepts the minimum: shelter, phone and one member', () => {
		const parsed = publicBookingInputSchema.parse(VALID);
		expect(parsed.shelter_code).toBe('SH001');
		expect(parsed.members).toHaveLength(1);
		expect(parsed.members[0].first_name).toBe('สมชาย');
		expect(parsed.members[0].last_name).toBe('ใจดี');
		expect(parsed.pets).toEqual([]);
	});

	it('requires a 10-digit phone — D-BOOK-TOKEN=A uses it as the second factor', () => {
		expect(publicBookingInputSchema.safeParse({ ...VALID, phone: null }).success).toBe(false);
		expect(publicBookingInputSchema.safeParse({ ...VALID, phone: '081234567' }).success).toBe(
			false
		);
	});

	// CR-107: the back office searches households by ตำบล/อำเภอ/จังหวัด, so those
	// three plus the house number are mandatory on a web booking too.
	it('requires house number, subdistrict, district and province', () => {
		const parsed = publicBookingInputSchema.parse(VALID);
		expect(parsed.address.address_no).toBe('123/45'); // trimmed
		expect(parsed.address.village_no).toBe('หมู่ 4');

		expect(publicBookingInputSchema.safeParse({ ...VALID, address: undefined }).success).toBe(
			false
		);
		for (const field of ['address_no', 'subdistrict', 'district', 'province'] as const) {
			const missing = publicBookingInputSchema.safeParse({
				...VALID,
				address: { ...ADDRESS, [field]: '  ' }
			});
			expect(missing.success, field).toBe(false);
		}
	});

	it('keeps หมู่/ถนน and the derived postal code optional, but rejects a malformed one', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			address: { ...ADDRESS, village_no: undefined, postal_code: undefined }
		});
		expect(parsed.address.village_no).toBe('');
		expect(parsed.address.postal_code).toBe('');

		expect(
			publicBookingInputSchema.safeParse({ ...VALID, address: { ...ADDRESS, postal_code: '901' } })
				.success
		).toBe(false);
	});

	it('requires at least one member and caps a single booking at 20', () => {
		expect(publicBookingInputSchema.safeParse({ ...VALID, members: [] }).success).toBe(false);
		const many = Array.from({ length: 21 }, () => CONTACT);
		expect(publicBookingInputSchema.safeParse({ ...VALID, members: many }).success).toBe(false);
	});

	// The shared `shelterCodeSchema` reports "Shelter code must look like SH001" —
	// a developer-facing English assertion. On the public form the only way to fail
	// it is to submit without choosing, so the citizen must get Thai instead.
	it('reports a missing or malformed shelter in Thai', () => {
		const blank = publicBookingInputSchema.safeParse({ ...VALID, shelter_code: '' });
		expect(blank.success).toBe(false);
		expect(blank.error?.issues[0].message).toBe('กรุณาเลือกศูนย์พักพิง');

		const malformed = publicBookingInputSchema.safeParse({ ...VALID, shelter_code: 'nope' });
		expect(malformed.success).toBe(false);
		expect(malformed.error?.issues[0].message).toBe('กรุณาเลือกศูนย์พักพิงจากรายการ');
	});

	it('defaults vehicles to an empty list when the citizen brings no car', () => {
		expect(publicBookingInputSchema.parse(VALID).vehicles).toEqual([]);
	});

	it('accepts vehicles with an optional plate, and rejects an unknown vehicle type', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			vehicles: [{ type: 'car', license_plate: ' กข 1234 สงขลา ' }, { type: 'motorcycle' }]
		});
		expect(parsed.vehicles).toEqual([
			{ type: 'car', license_plate: 'กข 1234 สงขลา' },
			{ type: 'motorcycle' }
		]);

		// `household.vehicles[].type` is still the closed car/motorcycle/other enum —
		// this form must not widen it (unlike pet species, which is master-data driven).
		expect(
			publicBookingInputSchema.safeParse({ ...VALID, vehicles: [{ type: 'boat' }] }).success
		).toBe(false);
	});

	it('caps a single booking at 10 vehicles', () => {
		const many = Array.from({ length: 11 }, () => ({ type: 'car' as const }));
		expect(publicBookingInputSchema.safeParse({ ...VALID, vehicles: many }).success).toBe(false);
	});

	it('accepts an optional 13-digit national id and rejects a malformed one', () => {
		expect(
			publicBookingInputSchema.safeParse({ ...VALID, national_id: '1234567890123' }).success
		).toBe(true);
		expect(publicBookingInputSchema.safeParse({ ...VALID, national_id: '123' }).success).toBe(
			false
		);
		// Absent is fine — a displaced person may have lost their card.
		expect(publicBookingInputSchema.safeParse(VALID).success).toBe(true);
	});

	it('drops fields the public form must not be able to set', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			_id: 'evacuee:ATTACKER',
			_rev: '9-x',
			registered_via: 'app',
			current_stay: { status: 'active' }
		});
		expect(parsed).not.toHaveProperty('_id');
		expect(parsed).not.toHaveProperty('_rev');
		expect(parsed).not.toHaveProperty('registered_via');
		expect(parsed).not.toHaveProperty('current_stay');
	});

	// A single "ชื่อ-นามสกุล" box used to be split on whitespace, which left
	// `last_name` empty for a one-word entry and crashed `createEvacuee` downstream
	// (it requires both non-empty) — first_name/last_name are now separate,
	// required fields so the schema itself rejects a missing surname up front.
	it('requires first_name but allows empty last_name for mononym / foreign nationals (CR-106 FR-18)', () => {
		expect(
			publicBookingInputSchema.safeParse({
				...VALID,
				members: [{ ...CONTACT, last_name: '' }]
			}).success
		).toBe(true);
		expect(
			publicBookingInputSchema.safeParse({
				...VALID,
				members: [{ ...CONTACT, first_name: '' }]
			}).success
		).toBe(false);
	});

	it('accepts optional birth_year and age for members', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			members: [{ ...CONTACT, birth_year: 2530, age: 39 }]
		});
		expect(parsed.members[0].birth_year).toBe(2530);
		expect(parsed.members[0].age).toBe(39);
	});
});

// The shelter's `pet_types` master data (global + per-shelter merge, CR-049)
// decides which species codes are on offer — the schema itself must accept
// whatever a shelter configures, not just the legacy `dog|cat|bird|other` set
// the field used to be limited to before `/api/public/v1/config/pet-types`
// existed.
describe('publicBookingPetSpeciesSchema (configured pet_types codes)', () => {
	it('accepts any non-empty, bounded master-data code — not just the old fixed set', () => {
		for (const code of ['dog', 'rabbit', 'item_01jabcdefghjkmnpqrstvwxyz']) {
			expect(publicBookingPetSpeciesSchema.safeParse(code).success).toBe(true);
		}
	});

	it('rejects an empty or whitespace-only species', () => {
		expect(publicBookingPetSpeciesSchema.safeParse('').success).toBe(false);
		expect(publicBookingPetSpeciesSchema.safeParse('   ').success).toBe(false);
	});

	it('rejects an unreasonably long species value', () => {
		expect(publicBookingPetSpeciesSchema.safeParse('x'.repeat(41)).success).toBe(false);
	});

	it('a booking carries the configured code straight through', () => {
		const parsed = publicBookingInputSchema.parse({
			...VALID,
			pets: [{ species: 'rabbit', has_cage: false }]
		});
		expect(parsed.pets[0].species).toBe('rabbit');
	});
});

describe('toEvacueeInputs → createEvacuee', () => {
	const input = publicBookingInputSchema.parse({
		...VALID,
		national_id: '1234567890123',
		members: [
			CONTACT,
			{ first_name: 'สมหญิง', last_name: 'ใจดี', gender: 'female', special_needs: ['ผู้สูงอายุ'] },
			{
				first_name: 'เด็กชายเล็ก',
				last_name: 'ใจดี',
				gender: 'male',
				special_needs: ['เด็กเล็ก', 'ผู้ป่วยเรื้อรัง']
			}
		]
	});
	const ctx = { shelterCode: 'SH001', createdBy: 'public' };

	it('mints every member pre_registered with registered_via web', () => {
		const evacuees = toEvacueeInputs(input, 'household:H1').map((i) => createEvacuee(i, ctx));

		expect(evacuees).toHaveLength(3);
		for (const e of evacuees) {
			expect(e.schema_v).toBe(10);
			expect(e.registered_via).toBe('web');

			expect(e.current_stay.status).toBe('pre_registered');
			expect(e.household_id).toBe('household:H1');
			expect(e.created_by).toBe('public');
			// Untouched staff defaults keep web and counter registrations identical.
			expect(e.country).toBe('THAILAND');
		}
	});

	it('gives the phone and national id to the contact only', () => {
		const evacuees = toEvacueeInputs(input, 'household:H1').map((i) => createEvacuee(i, ctx));

		expect(evacuees[0].phone).toBe('0812345678');
		expect(evacuees[0].person_id).toEqual({ cardType: 'national_id', number: '1234567890123' });
		// Members are reachable through the contact — they have no phone of their own.
		expect(evacuees[1].phone).toBeNull();
		expect(evacuees[1].person_id?.number ?? '').toBe('');
	});

	it('carries each member’s own vulnerability tags into special_needs', () => {
		const evacuees = toEvacueeInputs(input, 'household:H1').map((i) => createEvacuee(i, ctx));

		expect(evacuees[0].special_needs).toEqual([]);
		expect(evacuees[1].special_needs).toEqual(['ผู้สูงอายุ']);
		expect(evacuees[2].special_needs).toEqual(['เด็กเล็ก', 'ผู้ป่วยเรื้อรัง']);
	});

	it('carries birth_year and age when provided', () => {
		const inputWithAges = publicBookingInputSchema.parse({
			...VALID,
			members: [
				{ ...CONTACT, birth_year: 2530, age: 39 },
				{ first_name: 'อองซาน', last_name: '', gender: 'female', age: 10 }
			]
		});
		const evacuees = toEvacueeInputs(inputWithAges, 'household:H1').map((i) =>
			createEvacuee(i, ctx)
		);
		expect(evacuees[0].birth_year).toBe(2530);
		expect(evacuees[0].age).toBe(39);
		expect(evacuees[1].first_name).toBe('อองซาน');
		expect(evacuees[1].last_name).toBe('');
		expect(evacuees[1].age).toBe(10);
	});
});

describe('toHouseholdInput → createHousehold', () => {
	it('names the household after the contact and marks it pre_registered', () => {
		const input = publicBookingInputSchema.parse(VALID);
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.type).toBe('household');
		expect(household.label).toBe('ครอบครัวสมชาย ใจดี');
		expect(household.head_evacuee_id).toBe('evacuee:E1');
		expect(household.status).toBe('pre_registered');
		expect(household.pets).toEqual([]);
		expect(household.vehicles).toEqual([]);
	});

	// The address columns are what the back office searches on, so they must land
	// on the household doc itself — and a blank must arrive as `null`, not `''`,
	// or a search for "no หมู่" matches every web booking.
	it('carries the domicile address onto the household doc (CR-107)', () => {
		const input = publicBookingInputSchema.parse(VALID);
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.address_no).toBe('123/45');
		expect(household.village_no).toBe('หมู่ 4');
		expect(household.subdistrict).toBe('คอหงส์');
		expect(household.district).toBe('หาดใหญ่');
		expect(household.province).toBe('สงขลา');
		expect(household.postal_code).toBe('90110');
	});

	it('normalizes an unfilled หมู่/ถนน and postal code to null', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			address: { ...ADDRESS, village_no: '', postal_code: '' }
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.village_no).toBeNull();
		expect(household.postal_code).toBeNull();
	});

	it('maps pets onto the household pets[] shape (CR-016)', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			pets: [
				{ species: 'dog', notes: 'โกโก้ ชิวาว่า', has_cage: true },
				{ species: 'cat', has_cage: false }
			]
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.pets).toEqual([
			{ species: 'dog', count: 1, notes: 'โกโก้ ชิวาว่า', has_cage: true },
			{ species: 'cat', count: 1, has_cage: false }
		]);
	});

	// The household schema's `species` enum (docs/data/schema.md §1.3, CR-016) still
	// only knows dog/cat/bird/other — wiring `pet_types` master data all the way into
	// it is a separate CR-010 phase 2 that has not happened. A shelter-configured code
	// outside that set must not blow up `createHousehold`'s own validation, so it folds
	// into `other` with the real code preserved in `notes` rather than being lost.
	it('folds a species code outside the legacy household enum into "other", keeping it in notes', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			pets: [{ species: 'rabbit', notes: 'กระต่ายพันธุ์ฮอลแลนด์ลอป', has_cage: true }]
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.pets).toEqual([
			{
				species: 'other',
				count: 1,
				notes: 'กระต่ายพันธุ์ฮอลแลนด์ลอป — ชนิด: rabbit',
				has_cage: true
			}
		]);
	});

	it('maps pet name and condition into notes joined by | matching Station 1 format', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			pets: [{ species: 'dog', name: 'โกโก้', condition: 'ขาเจ็บ', has_cage: true }]
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.pets).toEqual([
			{ species: 'dog', count: 1, notes: 'โกโก้ | ขาเจ็บ', has_cage: true }
		]);
	});

	it('maps asset_description into household assets object', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			asset_description: 'ทองคำ 2 บาท และสมุดเงินฝาก'
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.assets).toEqual({
			description: 'ทองคำ 2 บาท และสมุดเงินฝาก',
			image_url: null
		});
	});

	it('leaves household assets null when asset_description is empty or blank', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			asset_description: '   '
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		expect(household.assets).toBeNull();
	});

	it('maps vehicles onto the household vehicles[] shape, blanking an unfilled plate', () => {
		const input = publicBookingInputSchema.parse({
			...VALID,
			vehicles: [{ type: 'car', license_plate: 'กข 1234' }, { type: 'motorcycle' }]
		});
		const household = createHousehold(toHouseholdInput(input, 'evacuee:E1'), {
			shelterCode: 'SH001',
			createdBy: 'public'
		});

		// `license_plate` is nullable in the household schema, so "no plate given"
		// has to arrive as `null` — not the empty string the form's input produces.
		expect(household.vehicles).toEqual([
			{ type: 'car', license_plate: 'กข 1234' },
			{ type: 'motorcycle', license_plate: null }
		]);
	});

	it('falls back to a generic label when the contact name is blank', () => {
		expect(householdLabelFrom({ first_name: '  ', last_name: '  ' })).toBe(
			'ครอบครัวผู้จองผ่านเว็บ'
		);
	});

	it('formats household label without trailing space when last_name is empty', () => {
		expect(householdLabelFrom({ first_name: 'สมชาย', last_name: '' })).toBe('ครอบครัวสมชาย');
	});
});

describe('booking code', () => {
	const ulid = '01JABCDEFGHJKMNPQRSTVWXYZ0';

	it('strips and restores the doc-id prefix', () => {
		expect(bookingCodeFrom(`evacuee:${ulid}`)).toBe(ulid);
		expect(evacueeIdFromBookingCode(ulid)).toBe(`evacuee:${ulid}`);
	});

	it('round-trips regardless of how the citizen types it', () => {
		for (const typed of [ulid, ulid.toLowerCase(), `evacuee:${ulid}`, `  ${ulid}  `]) {
			expect(evacueeIdFromBookingCode(typed)).toBe(`evacuee:${ulid}`);
		}
	});
});

describe('publicBookingLookupSchema', () => {
	it('needs both factors', () => {
		expect(publicBookingLookupSchema.safeParse({ code: 'X', phone: '0812345678' }).success).toBe(
			true
		);
		expect(publicBookingLookupSchema.safeParse({ code: '', phone: '0812345678' }).success).toBe(
			false
		);
		expect(publicBookingLookupSchema.safeParse({ code: 'X' }).success).toBe(false);
	});
});

describe('isCaptchaKeyConfigured', () => {
	it('accepts a real-looking key', () => {
		expect(isCaptchaKeyConfigured('6LcAbCdEfGhIjKlMnOpQrStUvWxYz0123456789')).toBe(true);
	});

	it('rejects the placeholders that ship in .env.example and test fixtures', () => {
		for (const placeholder of [
			'google_site_key',
			'google_secret_key',
			'dummy-secret',
			'change-me-in-staging'
		]) {
			expect(isCaptchaKeyConfigured(placeholder)).toBe(false);
		}
	});

	it('rejects absent or blank values', () => {
		expect(isCaptchaKeyConfigured(undefined)).toBe(false);
		expect(isCaptchaKeyConfigured(null)).toBe(false);
		expect(isCaptchaKeyConfigured('   ')).toBe(false);
	});
});

describe('publicBookingErrorMessage', () => {
	it('maps known codes to Thai copy', () => {
		expect(publicBookingErrorMessage('SHELTER_CLOSED')).toContain('ปิดรับ');
		expect(publicBookingErrorMessage('RATE_LIMITED')).toContain('ถี่เกินไป');
	});

	it('falls back for anything unrecognised', () => {
		expect(publicBookingErrorMessage('WAT')).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง');
	});
});
