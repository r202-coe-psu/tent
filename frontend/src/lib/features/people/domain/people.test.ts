// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import {
	createEvacuee,
	createDraftEvacueeFromCard,
	createMovement,
	createScreening,
	applyMovementToStay,
	assertMovementAllowed,
	canCheckInEvacuee,
	canCheckOutEvacuee,
	canChangeEvacueeZone,
	canCancelEvacueePreRegistration,
	canCancelHouseholdPreRegistration,
	CHECK_IN_ELIGIBLE_STATUSES,
	CHECK_OUT_ELIGIBLE_STATUSES,
	resolveStatusChangeAction,
	matchesEvacueeSearch,
	isEvacuee,
	createHousehold,
	isHousehold,
	migrateHouseholdV3ToV4,
	checkEvacueeHouseholdConflict,
	assertEvacueeHouseholdAssignment,
	assertHouseholdStatusTransition,
	assertCheckoutDestination,
	MANUAL_HOUSEHOLD_STATUS_TRANSITIONS,
	evacueeInputSchema,
	station1EvacueeInputSchema,
	triageLevelSchema,
	screeningInputSchema,
	householdPreRegisterEvacueeSchema,
	householdPreRegisterAddressFormSchema,
	householdPostArrivalAddressFormSchema,
	evacueePersonalEditFormSchema,
	evacueeHealthEditFormSchema,
	formatPersonName,
	stayStatusSchema,
	STATUS_LABELS,
	CARD_NUMBER_MAX_LENGTH,
	cardNumberMaxLength,
	cardNumberEffectiveLength,
	clampCardNumber,
	personIdSchema,
	mintAnonymousId,
	isAnonymousId,
	replacePersonId,
	migrateVulnerableGroupCode,
	migrateVulnerableGroupCodes,
	housingTypeSchema,
	householdInputSchema
} from './people';
import type { AuthorContext } from '$lib/db/model';
import { isUlid } from '$lib/db/ulid';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

describe('card number max length by card type', () => {
	it('exposes max lengths matching household / Station 1 UI rules', () => {
		expect(CARD_NUMBER_MAX_LENGTH).toEqual({
			national_id: 13,
			passport: 9,
			pink_card: undefined,
			other: undefined,
			anonymous: undefined
		});
		expect(cardNumberMaxLength('national_id')).toBe(13);
		expect(cardNumberMaxLength('passport')).toBe(9);
		expect(cardNumberMaxLength('pink_card')).toBeUndefined();
		expect(cardNumberMaxLength('other')).toBeUndefined();
		expect(cardNumberMaxLength('anonymous')).toBeUndefined();
	});

	it('clamps national_id to digits and passport to 9 chars', () => {
		expect(clampCardNumber('national_id', '1-2345-67890-12-34')).toBe('1234567890123');
		expect(clampCardNumber('passport', 'AB1234567890')).toBe('AB1234567');
		expect(clampCardNumber('other', 'ABCDEFGHIJKLMNOP')).toBe('ABCDEFGHIJKLMNOP');
	});

	it('rejects person_id numbers longer than the type max via personIdSchema', () => {
		expect(
			personIdSchema.safeParse({ cardType: 'national_id', number: '12345678901234' }).success
		).toBe(false);
		expect(personIdSchema.safeParse({ cardType: 'passport', number: 'AB12345678' }).success).toBe(
			false
		);
		expect(personIdSchema.safeParse({ cardType: 'passport', number: 'AB1234567' }).success).toBe(
			true
		);
		expect(
			personIdSchema.safeParse({ cardType: 'other', number: 'ABCDEFGHIJKLMNOP' }).success
		).toBe(true);
	});

	it('rejects over-length passport on evacueePersonalEditFormSchema', () => {
		const result = evacueePersonalEditFormSchema.safeParse({
			firstName: 'Alex',
			lastName: 'Doe',
			nickname: '',
			birthYear: '',
			age: '',
			gender: 'other',
			phone: '',
			noPhone: true,
			cardType: 'passport',
			cardNumber: 'AB12345678',
			country: 'USA',
			religion: 'unknown'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.some((i) => i.path.includes('cardNumber'))).toBe(true);
		}
	});

	it('reports effective length digits-only for national_id', () => {
		expect(cardNumberEffectiveLength('national_id', '1-2345-67890-12-3')).toBe(13);
		expect(cardNumberEffectiveLength('passport', 'AB1234567')).toBe(9);
	});
});

describe('stayStatusSchema and STATUS_LABELS', () => {
	it('accepts arriving', () => {
		expect(stayStatusSchema.parse('arriving')).toBe('arriving');
	});

	it('contains arriving in STATUS_LABELS with Thai label', () => {
		expect(STATUS_LABELS.arriving).toBe('อยู่ระหว่างรอเข้าพัก (รอตรวจ/รอจัดโซน)');
	});
});

describe('vulnerable_groups vs special_needs', () => {
	it('defaults vulnerable_groups to [] and keeps special_needs independent', () => {
		const e = createEvacuee(
			{
				first_name: 'เปราะบาง',
				last_name: 'แยกฟิลด์',
				gender: 'other',
				phone: null,
				special_needs: ['ใช้ออกซิเจน'],
				vulnerable_groups: ['wheelchair', 'pregnant']
			},
			ctx
		);
		expect(e.vulnerable_groups).toEqual(['wheelchair', 'pregnant']);
		expect(e.special_needs).toEqual(['ใช้ออกซิเจน']);
		expect(e.schema_v).toBe(10);

		const bare = createEvacuee(
			{ first_name: 'A', last_name: 'B', gender: 'other', phone: null },
			ctx
		);
		expect(bare.vulnerable_groups).toEqual([]);
		expect(bare.special_needs).toEqual([]);
	});

	it('hard-migrates legacy VG codes elderly→elderly_dependent and disabled→disability_other', () => {
		expect(migrateVulnerableGroupCode('elderly')).toBe('elderly_dependent');
		expect(migrateVulnerableGroupCode('disabled')).toBe('disability_other');
		expect(migrateVulnerableGroupCode('chronic_illness')).toBe('chronic_illness');
		expect(migrateVulnerableGroupCode('wheelchair')).toBe('wheelchair');
		expect(migrateVulnerableGroupCodes(['elderly', 'disabled', 'infant'])).toEqual([
			'elderly_dependent',
			'disability_other',
			'infant'
		]);
	});
});

describe('Anonymous ID', () => {
	it('mints ANON-{ulid} handles', () => {
		const id = mintAnonymousId();
		expect(id.startsWith('ANON-')).toBe(true);
		expect(isAnonymousId(id)).toBe(true);
		expect(isUlid(id.slice('ANON-'.length))).toBe(true);
	});

	it('createEvacuee with cardType anonymous persists a unique ANON-{ulid}', () => {
		const a = createEvacuee(
			{
				first_name: 'ไม่มี',
				last_name: 'บัตร',
				gender: 'other',
				phone: null,
				person_id: { cardType: 'anonymous' }
			},
			ctx
		);
		const b = createEvacuee(
			{
				first_name: 'อีกคน',
				last_name: 'ไม่มีบัตร',
				gender: 'other',
				phone: null,
				person_id: { cardType: 'anonymous', number: '' }
			},
			ctx
		);
		expect(a.schema_v).toBe(10);
		expect(a.person_id?.cardType).toBe('anonymous');
		expect(isAnonymousId(a.person_id?.number ?? '')).toBe(true);
		expect(b.person_id?.number).not.toBe(a.person_id?.number);
		expect(a.country).toBe('THAILAND');
	});

	it('finds an Evacuee by Anonymous ID via matchesEvacueeSearch', () => {
		const e = createEvacuee(
			{
				first_name: 'ค้นหา',
				last_name: 'อนนาม',
				gender: 'other',
				phone: null,
				person_id: { cardType: 'anonymous' }
			},
			ctx
		);
		const anon = e.person_id!.number!;
		expect(matchesEvacueeSearch(e, anon)).toBe(true);
		expect(matchesEvacueeSearch(e, anon.toLowerCase())).toBe(true);
		expect(matchesEvacueeSearch(e, anon.slice(5, 15))).toBe(true);
		expect(matchesEvacueeSearch(e, 'ANON-NOTREAL')).toBe(false);
	});

	it('replacePersonId swaps Anonymous ID for a real card without a separate Person entity', () => {
		const e = createEvacuee(
			{
				first_name: 'สมศรี',
				last_name: 'มีบัตรทีหลัง',
				gender: 'female',
				phone: '0811111111',
				person_id: { cardType: 'anonymous' }
			},
			ctx
		);
		const replaced = replacePersonId(e, {
			cardType: 'national_id',
			number: '1103700123456'
		});
		expect(replaced.person_id).toEqual({
			cardType: 'national_id',
			number: '1103700123456'
		});
		expect(replaced._id).toBe(e._id);
		expect(isAnonymousId(replaced.person_id?.number ?? '')).toBe(false);
	});

	it('requires country and defaults Registration input to THAILAND', () => {
		expect(evacueeInputSchema.safeParse({}).success).toBe(false);
		const parsed = evacueeInputSchema.parse({
			first_name: 'A',
			last_name: 'B',
			gender: 'other',
			phone: null
		});
		expect(parsed.country).toBe('THAILAND');
		expect(personIdSchema.safeParse({ cardType: 'anonymous' }).success).toBe(true);
	});
});

describe('createEvacuee', () => {
	it('stamps the envelope and applies spec defaults', () => {
		const e = createEvacuee(
			{ first_name: '  สมชาย ', last_name: 'ใจดี', gender: 'male', phone: '0812345678' },
			ctx
		);
		expect(e._id.startsWith('evacuee:')).toBe(true);
		expect(e.type).toBe('evacuee');
		expect(e.schema_v).toBe(10);
		expect(e.shelter_code).toBe('SH001');
		expect(e.created_by).toBe('staff1');
		expect(e.created_at).toBe(e.updated_at);
		expect(e.first_name).toBe('สมชาย'); // trimmed
		expect(e.privacy).toEqual({ search_excluded: false });
		expect(e.current_stay.status).toBe('pre_registered');
		expect(e.country).toBe('THAILAND');
		expect(e.special_needs).toEqual([]);
		expect(e.registered_via).toBe('staff');
		expect(isEvacuee(e)).toBe(true);
	});

	it('stamps schema_v: 10 and supports status arriving', () => {
		const e = createEvacuee(
			{
				first_name: 'วิภา',
				last_name: 'สุขใจ',
				gender: 'female',
				phone: '0899999999',
				status: 'arriving'
			},
			ctx
		);
		expect(e.schema_v).toBe(10);
		expect(e.current_stay.status).toBe('arriving');
	});

	it('creates evacuee from card snapshot with schema_v 8, status pre_registered, and registered_via kiosk', () => {
		const card = {
			citizen_id: '1234567890123',
			title_th: 'นาย',
			first_name_th: 'สมศักดิ์',
			last_name_th: 'รักชาติ',
			gender: 'male' as const,
			birth_year_ce: 1990,
			age: 36,
			scanned_at: '2026-08-29T10:00:00Z',
			device_id: 'DEV-01',
			station_name: 'จุดสแกน Kiosk 1'
		};
		const kioskEv = createDraftEvacueeFromCard(card, ctx);
		expect(kioskEv._id.startsWith('evacuee:')).toBe(true);
		expect(kioskEv.type).toBe('evacuee');
		expect(kioskEv.schema_v).toBe(8);
		expect(kioskEv.first_name).toBe('สมศักดิ์');
		expect(kioskEv.last_name).toBe('รักชาติ');
		expect(kioskEv.birth_year).toBe(2533);
		expect(kioskEv.age).toBe(36);
		expect(kioskEv.current_stay.status).toBe('pre_registered');
		expect(kioskEv.household_id).toBeNull();
		expect(kioskEv.registered_via).toBe('kiosk');
		expect(kioskEv.person_id?.number).toBe('1234567890123');
		expect(kioskEv.card_snapshot?.station_name).toBe('จุดสแกน Kiosk 1');
	});

	it('creates draft evacuee and calculates age automatically from birth_year_ce when age is not provided', () => {
		const card = {
			citizen_id: '1234567890123',
			first_name_th: 'วิชัย',
			last_name_th: 'ใจดี',
			birth_year_ce: 1996,
			scanned_at: '2026-08-29T10:00:00Z',
			device_id: 'DEV-01'
		};
		const draft = createDraftEvacueeFromCard(card, ctx);
		expect(draft.birth_year).toBe(2539);
		expect(draft.age).toBe(new Date().getFullYear() + 543 - 2539);
	});

	it('accepts "no phone" as null', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'other', phone: null }, ctx);
		expect(e.phone).toBeNull();
	});

	// CR-070 D-REG-VIA — public booking writes `web`; the enum stays additive so
	// existing `app` / `import` / `paper` docs need no backfill.
	it('carries registered_via "web" for public bookings', () => {
		const e = createEvacuee(
			{
				first_name: 'ก',
				last_name: 'ข',
				gender: 'female',
				phone: '0812345678',
				registered_via: 'web'
			},
			ctx
		);
		expect(e.registered_via).toBe('web');
		expect(e.current_stay.status).toBe('pre_registered');
	});

	it('rejects an unknown registration channel', () => {
		expect(() =>
			createEvacuee(
				{
					first_name: 'ก',
					last_name: 'ข',
					gender: 'male',
					phone: '0812345678',
					// `api` is reserved for CR-071 and must not be accepted yet.
					registered_via: 'api' as never
				},
				ctx
			)
		).toThrow();
	});

	it('rejects an empty first name', () => {
		expect(() =>
			createEvacuee({ first_name: '  ', last_name: 'ข', gender: 'male', phone: null }, ctx)
		).toThrow();
	});

	it('allows an empty last name for mononyms (CR-106 FR-18)', () => {
		const e = createEvacuee(
			{ first_name: 'Aung San', last_name: '  ', gender: 'male', phone: null, country: 'MYANMAR' },
			ctx
		);
		expect(e.first_name).toBe('Aung San');
		expect(e.last_name).toBe('');
	});

	it('defaults photo to absent, and carries it through when set (CR-054)', () => {
		const withoutPhoto = createEvacuee(
			{ first_name: 'ก', last_name: 'ข', gender: 'other', phone: null },
			ctx
		);
		expect(withoutPhoto.photo).toBeUndefined();

		const withPhoto = createEvacuee(
			{ first_name: 'ก', last_name: 'ข', gender: 'other', phone: null, photo: 'image:01H...' },
			ctx
		);
		expect(withPhoto.photo).toBe('image:01H...');
	});
});

describe('household wizard schemas', () => {
	it('requires identity and emergency contact for pre-registration with Thai errors', () => {
		const result = householdPreRegisterEvacueeSchema.safeParse({
			first_name: 'สมชาย',
			last_name: 'ใจดี',
			gender: 'male',
			phone: '0812345678',
			person_id: { cardType: 'national_id', number: '' },
			emergency_contact: { name: '', phone: '', relation: 'contact' }
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((issue) => issue.message)).toEqual(
				expect.arrayContaining([
					'กรุณากรอกเลขประจำตัวหรือเลขที่เอกสาร',
					'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน',
					'กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก'
				])
			);
		}
	});

	it('validates all required pre-registration address fields', () => {
		const result = householdPreRegisterAddressFormSchema.safeParse({
			addressNo: '',
			villageNo: '',
			subdistrict: '',
			district: '',
			province: '',
			postalCode: '',
			municipalityZone: '',
			community: ''
		});

		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues).toHaveLength(8);
			expect(result.error.issues.every((issue) => /[ก-๙]/.test(issue.message))).toBe(true);
		}
	});

	it('keeps post-arrival notes optional while validating the base address', () => {
		const result = householdPostArrivalAddressFormSchema.safeParse({
			addressNo: '12/3',
			villageNo: '',
			subdistrict: 'หาดใหญ่',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postalCode: '',
			municipalityZone: '',
			community: ''
		});

		expect(result.success).toBe(true);
		if (result.success) expect(result.data.notes).toBe('');
	});
});

describe('station1EvacueeInputSchema emergency contact', () => {
	const base = { first_name: 'ก', last_name: 'ข', gender: 'male' as const, phone: null };

	it('keeps emergency contact optional on evacueeInputSchema for kiosk and import', () => {
		expect(evacueeInputSchema.safeParse(base).success).toBe(true);
	});

	it('accepts a missing or blank emergency contact on Station 1', () => {
		expect(station1EvacueeInputSchema.safeParse(base).success).toBe(true);

		const blank = station1EvacueeInputSchema.safeParse({
			...base,
			emergency_contact: { name: '', phone: '', relation: '' }
		});
		expect(blank.success).toBe(true);
		if (blank.success) {
			expect(blank.data.emergency_contact).toBeUndefined();
		}
	});

	it('rejects a partial emergency contact on Station 1', () => {
		const partial = station1EvacueeInputSchema.safeParse({
			...base,
			emergency_contact: { name: 'มานี', phone: '', relation: '' }
		});
		expect(partial.success).toBe(false);
		if (!partial.success) {
			expect(partial.error.issues.map((issue) => issue.message)).toEqual(
				expect.arrayContaining([
					'กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก',
					'กรุณาระบุความสัมพันธ์ของผู้ติดต่อฉุกเฉิน'
				])
			);
		}
	});

	it('accepts a complete emergency contact on Station 1', () => {
		const result = station1EvacueeInputSchema.safeParse({
			...base,
			emergency_contact: { name: 'มานี', phone: '0812345678', relation: 'มารดา' }
		});
		expect(result.success).toBe(true);
	});
});

describe('evacueeInputSchema birth_year', () => {
	const base = { first_name: 'ก', last_name: 'ข', gender: 'male' as const, phone: null };

	it('accepts a plausible birth_year (พ.ศ.)', () => {
		const result = evacueeInputSchema.safeParse({ ...base, birth_year: 2530 });
		expect(result.success).toBe(true);
	});

	it('leaves birth_year optional', () => {
		const result = evacueeInputSchema.safeParse(base);
		expect(result.success).toBe(true);
	});

	it('rejects a birth_year implying an age over 150 years', () => {
		const currentBEYear = new Date().getFullYear() + 543;
		const minBirthYearBE = currentBEYear - 150;
		const result = evacueeInputSchema.safeParse({ ...base, birth_year: minBirthYearBE });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((i) => i.message)).toContain(
				`ปีเกิด (พ.ศ.) ต้องมากกว่า ${minBirthYearBE}`
			);
		}
	});

	it('accepts a birth_year implying an age of exactly 150 years', () => {
		const currentBEYear = new Date().getFullYear() + 543;
		const result = evacueeInputSchema.safeParse({ ...base, birth_year: currentBEYear - 150 + 1 });
		expect(result.success).toBe(true);
	});

	it('accepts a newborn — birth_year equal to the current year (age 0)', () => {
		const currentBEYear = new Date().getFullYear() + 543;
		const result = evacueeInputSchema.safeParse({ ...base, birth_year: currentBEYear });
		expect(result.success).toBe(true);
	});

	it('rejects a birth_year in the future', () => {
		const currentBEYear = new Date().getFullYear() + 543;
		const result = evacueeInputSchema.safeParse({ ...base, birth_year: currentBEYear + 1 });
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.map((i) => i.message)).toContain(
				'ปีเกิด (พ.ศ.) ต้องไม่เป็นปีในอนาคต'
			);
		}
	});
});

describe('evacueePersonalEditFormSchema age', () => {
	it('accepts newborn age 0 without treating it as empty', () => {
		const currentBEYear = new Date().getFullYear() + 543;
		const result = evacueePersonalEditFormSchema.safeParse({
			firstName: 'ทารก',
			lastName: 'แรกเกิด',
			nickname: '',
			birthYear: String(currentBEYear),
			age: '0',
			gender: 'other',
			phone: '',
			noPhone: true,
			cardType: 'national_id',
			cardNumber: '',
			country: 'THAILAND',
			religion: 'unknown'
		});

		expect(result.success).toBe(true);
	});

	it('allows an empty lastName (CR-106 FR-18)', () => {
		const result = evacueePersonalEditFormSchema.safeParse({
			firstName: 'Suu Kyi',
			lastName: '',
			nickname: '',
			birthYear: '',
			age: '',
			gender: 'female',
			phone: '',
			noPhone: true,
			cardType: 'passport',
			cardNumber: 'AB1234567',
			country: 'MYANMAR',
			religion: 'buddhist'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.lastName).toBe('');
		}
	});
});

describe('formatPersonName', () => {
	it('joins first and last name', () => {
		expect(formatPersonName({ first_name: 'สมชาย', last_name: 'ใจดี' })).toBe('สมชาย ใจดี');
	});

	it('omits empty last name without trailing space', () => {
		expect(formatPersonName({ first_name: 'Aung San', last_name: '' })).toBe('Aung San');
		expect(formatPersonName({ first_name: 'Aung San', last_name: '   ' })).toBe('Aung San');
	});
});

describe('evacueeHealthEditFormSchema temperature', () => {
	const base = {
		bloodGroup: 'unknown' as const,
		careTrack: 'normal' as const,
		conditions: '',
		medications: '',
		allergies: '',
		medicalNotes: '',
		screeningNotes: '',
		selectedSymptoms: [],
		referral: false,
		specialNeeds: []
	};

	// `<input type="number">` bindings hand us a number, so the schema must take one as-is.
	it('accepts the number a number input binds', () => {
		const result = evacueeHealthEditFormSchema.safeParse({ ...base, temperature: 37.5 });

		expect(result.success).toBe(true);
		expect(result.data?.temperature).toBe(37.5);
	});

	it('accepts null for a cleared field', () => {
		const result = evacueeHealthEditFormSchema.safeParse({ ...base, temperature: null });

		expect(result.success).toBe(true);
		expect(result.data?.temperature).toBeNull();
	});

	it('rejects a temperature outside 30–45 °C', () => {
		for (const temperature of [29.9, 45.1]) {
			const result = evacueeHealthEditFormSchema.safeParse({ ...base, temperature });

			expect(result.success).toBe(false);
			expect(result.error?.issues[0].message).toBe('อุณหภูมิต้องอยู่ระหว่าง 30 ถึง 45 °C');
		}
	});

	it('accepts the 30 and 45 °C bounds', () => {
		for (const temperature of [30, 45]) {
			expect(evacueeHealthEditFormSchema.safeParse({ ...base, temperature }).success).toBe(true);
		}
	});
});

describe('movement → current_stay', () => {
	it('check_in moves the snapshot to active at the event time', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const m = createMovement(
			{
				evacuee_id: e._id,
				action: 'check_in',
				zone: 'Z1',
				occurred_at: '2026-06-11T03:00:00.000Z'
			},
			ctx
		);
		const updated = applyMovementToStay(e, m);
		expect(updated.current_stay.status).toBe('active');
		expect(updated.current_stay.zone).toBe('Z1');
		expect(updated.current_stay.since).toBe('2026-06-11T03:00:00.000Z');
	});

	it('allows check_in transition from arriving to active via applyMovementToStay', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const arriving = {
			...e,
			current_stay: { status: 'arriving' as const, zone: null, since: e.current_stay.since }
		};
		expect(canCheckInEvacuee(arriving)).toBe(true);

		const m = createMovement(
			{
				evacuee_id: e._id,
				action: 'check_in',
				zone: 'Z1',
				occurred_at: '2026-06-11T03:00:00.000Z'
			},
			ctx
		);
		const updated = applyMovementToStay(arriving, m);
		expect(updated.current_stay.status).toBe('active');
		expect(updated.current_stay.zone).toBe('Z1');
		expect(updated.current_stay.since).toBe('2026-06-11T03:00:00.000Z');
	});

	it('allows check_in from eligible stay statuses only', () => {
		const statuses = [
			'pre_registered',
			'arriving',
			'temporary_leave',
			'checked_out',
			'transferred',
			'active',
			'deceased',
			'cancelled'
		] as const;

		const base = createEvacuee(
			{ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null },
			ctx
		);

		const allowed = statuses.filter((status) =>
			canCheckInEvacuee({
				...base,
				current_stay: { status, zone: null, since: base.current_stay.since }
			})
		);

		expect(allowed).toEqual([
			'pre_registered',
			'arriving',
			'temporary_leave',
			'checked_out',
			'transferred'
		]);
	});

	it('rejects check_in from deceased (terminal status)', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const deceased = {
			...e,
			current_stay: { status: 'deceased' as const, zone: null, since: e.current_stay.since }
		};
		expect(canCheckInEvacuee(deceased)).toBe(false);
		expect(canCheckOutEvacuee(deceased)).toBe(false);
		expect(() => assertMovementAllowed(deceased, 'check_in')).toThrow(/เสียชีวิต/);

		const m = createMovement({ evacuee_id: e._id, action: 'check_in', zone: null }, ctx);
		expect(() => applyMovementToStay(deceased, m)).toThrow(/เสียชีวิต/);
	});

	it('rejects movement from cancelled stay (terminal status)', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const cancelled = {
			...e,
			current_stay: { status: 'cancelled' as const, zone: null, since: e.current_stay.since }
		};
		expect(canCheckInEvacuee(cancelled)).toBe(false);
		expect(canCancelEvacueePreRegistration(cancelled)).toBe(false);
		expect(() => assertMovementAllowed(cancelled, 'check_in')).toThrow(/ยกเลิก/);
	});

	it('canCancel* helpers only allow pre_registered', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(canCancelEvacueePreRegistration(e)).toBe(true);
		const hh = createHousehold(
			{
				label: 'บ้านทดสอบ',
				head_evacuee_id: e._id,
				status: 'pre_registered',
				municipality_zone: null,
				community: null,
				pets: [],
				vehicles: []
			},
			ctx
		);
		expect(canCancelHouseholdPreRegistration(hh)).toBe(true);
		expect(canCancelHouseholdPreRegistration({ ...hh, status: 'checked_in' })).toBe(false);
	});

	it('rejects check_out unless status is active', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(canCheckOutEvacuee(e)).toBe(false);
		expect(() => assertMovementAllowed(e, 'check_out')).toThrow(/เช็คเอาท์/);
	});

	it('zone_change keeps status active and updates zone', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		const active = {
			...e,
			current_stay: { status: 'active' as const, zone: 'Z1', since: e.current_stay.since }
		};
		expect(canChangeEvacueeZone(active)).toBe(true);
		const m = createMovement(
			{
				evacuee_id: e._id,
				action: 'zone_change',
				zone: 'Z2',
				occurred_at: '2026-09-03T04:00:00.000Z'
			},
			ctx
		);
		const updated = applyMovementToStay(active, m);
		expect(updated.current_stay.status).toBe('active');
		expect(updated.current_stay.zone).toBe('Z2');
		expect(updated.current_stay.since).toBe('2026-09-03T04:00:00.000Z');
	});

	it('rejects zone_change without destination or from non-active', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(canChangeEvacueeZone(e)).toBe(false);
		const active = {
			...e,
			current_stay: { status: 'active' as const, zone: 'Z1', since: e.current_stay.since }
		};
		const m = createMovement({ evacuee_id: e._id, action: 'zone_change', zone: null }, ctx);
		expect(() => applyMovementToStay(active, m)).toThrow(/โซนปลายทาง/);
	});

	it('allows check_in from eligible stay statuses only', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(canCheckInEvacuee(e)).toBe(true); // pre_registered
		expect(CHECK_IN_ELIGIBLE_STATUSES).toContain('pre_registered');
		expect(CHECK_OUT_ELIGIBLE_STATUSES).toEqual(['active']);

		const active = {
			...e,
			current_stay: { status: 'active' as const, zone: 'Z1', since: e.current_stay.since }
		};
		expect(canCheckInEvacuee(active)).toBe(false);
		expect(canCheckOutEvacuee(active)).toBe(true);
	});

	it('rejects transfer_out / leave_temporary unless status is active', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(() => assertMovementAllowed(e, 'transfer_out')).toThrow(/ย้ายออก/);
		expect(() => assertMovementAllowed(e, 'leave_temporary')).toThrow(/ลาชั่วคราว/);

		const active = {
			...e,
			current_stay: { status: 'active' as const, zone: 'Z1', since: e.current_stay.since }
		};
		expect(() => assertMovementAllowed(active, 'transfer_out')).not.toThrow();
		expect(() => assertMovementAllowed(active, 'leave_temporary')).not.toThrow();
	});
});

describe('resolveStatusChangeAction', () => {
	it('returns null when the status is unchanged', () => {
		expect(resolveStatusChangeAction('active', 'active')).toBeNull();
	});

	it('returns null for pre_registered → checked_out (must check in first)', () => {
		expect(resolveStatusChangeAction('pre_registered', 'checked_out')).toBeNull();
	});

	it('returns null for checked_out → temporary_leave / transferred (must check in first)', () => {
		expect(resolveStatusChangeAction('checked_out', 'temporary_leave')).toBeNull();
		expect(resolveStatusChangeAction('checked_out', 'transferred')).toBeNull();
	});

	it('returns null from terminal statuses (deceased, cancelled)', () => {
		expect(resolveStatusChangeAction('deceased', 'active')).toBeNull();
		expect(resolveStatusChangeAction('cancelled', 'active')).toBeNull();
	});

	it('resolves valid transitions to their movement action', () => {
		expect(resolveStatusChangeAction('pre_registered', 'active')).toBe('check_in');
		expect(resolveStatusChangeAction('temporary_leave', 'active')).toBe('return_from_leave');
		expect(resolveStatusChangeAction('active', 'checked_out')).toBe('check_out');
		expect(resolveStatusChangeAction('active', 'transferred')).toBe('transfer_out');
		expect(resolveStatusChangeAction('active', 'temporary_leave')).toBe('leave_temporary');
		expect(resolveStatusChangeAction('active', 'deceased')).toBe('mark_deceased');
	});
});

describe('triageLevelSchema and screeningInputSchema', () => {
	it('validates triageLevelSchema enum green, yellow, red', () => {
		expect(triageLevelSchema.parse('green')).toBe('green');
		expect(triageLevelSchema.parse('yellow')).toBe('yellow');
		expect(triageLevelSchema.parse('red')).toBe('red');
		expect(() => triageLevelSchema.parse('blue')).toThrow();
	});

	it('screeningInputSchema accepts triage_level and vital signs', () => {
		const parsed = screeningInputSchema.parse({
			evacuee_id: 'evacuee:01J',
			track: 'normal',
			triage_level: 'yellow',
			blood_pressure_sys: 120,
			blood_pressure_dia: 80,
			heart_rate: 75,
			spo2_percent: 98
		});
		expect(parsed.triage_level).toBe('yellow');
		expect(parsed.blood_pressure_sys).toBe(120);
		expect(parsed.blood_pressure_dia).toBe(80);
		expect(parsed.heart_rate).toBe(75);
		expect(parsed.spo2_percent).toBe(98);
	});

	it('screeningInputSchema allows null or omitted triage_level and vitals', () => {
		const parsed = screeningInputSchema.parse({
			evacuee_id: 'evacuee:01J',
			track: 'normal',
			triage_level: null
		});
		expect(parsed.triage_level).toBeNull();
		expect(parsed.blood_pressure_sys).toBeUndefined();
	});
});

describe('createScreening', () => {
	it('defaults the screening time to now when omitted, stamps schema_v: 2 and triage_level: null', () => {
		const s = createScreening({ evacuee_id: 'evacuee:x', track: 'fast_track' }, ctx);
		expect(s.type).toBe('screening');
		expect(s.schema_v).toBe(2);
		expect(s.triage_level).toBeNull();
		expect(s.vital_signs).toBeUndefined();
		expect(s.needs_referral).toBe(false);
		expect(s.symptoms).toEqual([]);
		expect(typeof s.screened_at).toBe('string');
	});

	it('stamps schema_v: 2, triage_level, and vital signs when provided', () => {
		const s = createScreening(
			{
				evacuee_id: 'evacuee:x',
				track: 'fast_track',
				triage_level: 'red',
				blood_pressure_sys: 140,
				blood_pressure_dia: 90,
				heart_rate: 105,
				spo2_percent: 92
			},
			ctx
		);
		expect(s.schema_v).toBe(2);
		expect(s.triage_level).toBe('red');
		expect(s.vital_signs).toEqual({
			blood_pressure_sys: 140,
			blood_pressure_dia: 90,
			heart_rate: 105,
			spo2_percent: 92
		});
	});
});

describe('pet species dog|cat|other', () => {
	it('accepts dog/cat/other and requires notes for other', () => {
		expect(
			householdInputSchema.safeParse({
				label: 'มีหมา',
				pets: [{ species: 'dog', count: 1 }]
			}).success
		).toBe(true);
		expect(
			householdInputSchema.safeParse({
				label: 'สัตว์อื่นๆ',
				pets: [{ species: 'other', count: 1, notes: 'กระต่าย' }]
			}).success
		).toBe(true);
		expect(
			householdInputSchema.safeParse({
				label: 'other ไม่มี notes',
				pets: [{ species: 'other', count: 1 }]
			}).success
		).toBe(false);
		expect(
			householdInputSchema.safeParse({
				label: 'bird เลิกใช้',
				pets: [{ species: 'bird', count: 1 }]
			}).success
		).toBe(false);
	});

	it('migrates legacy bird pets to other with notes นก', () => {
		expect(migratePetGroup({ species: 'bird', count: 2 })).toEqual({
			species: 'other',
			count: 2,
			notes: 'นก'
		});
		expect(migratePetGroup({ species: 'dog', count: 1, notes: 'friendly' })).toEqual({
			species: 'dog',
			count: 1,
			notes: 'friendly'
		});
		expect(
			migratePetGroups([
				{ species: 'bird', count: 1 },
				{ species: 'cat', count: 1 }
			])
		).toEqual([
			{ species: 'other', count: 1, notes: 'นก' },
			{ species: 'cat', count: 1 }
		]);
	});
});

describe('household housing_type and homeless Residence', () => {
	it('stamps housing_type and optional residence_landmark at schema_v 5', () => {
		const h = createHousehold(
			{
				label: 'บ้านมีที่',
				housing_type: 'owned_house',
				residence_landmark: 'ใกล้สะพาน',
				address_no: '10',
				subdistrict: 'หาดใหญ่',
				district: 'หาดใหญ่',
				province: 'สงขลา'
			},
			ctx
		);
		expect(h.schema_v).toBe(5);
		expect(h.housing_type).toBe('owned_house');
		expect(h.residence_landmark).toBe('ใกล้สะพาน');
		expect(housingTypeSchema.parse('homeless')).toBe('homeless');
	});

	it('allows homeless Household with empty address_no when landmark is present', () => {
		const h = createHousehold(
			{
				label: 'ไร้บ้านเลขที่',
				housing_type: 'homeless',
				residence_landmark: 'ริมคลองข้างตลาด',
				address_no: null
			},
			ctx
		);
		expect(h.address_no).toBeNull();
		expect(h.housing_type).toBe('homeless');
	});

	it('allows homeless Household with empty address_no when geo is complete', () => {
		const result = householdInputSchema.safeParse({
			label: 'ไร้บ้านแต่มีภูมิ',
			housing_type: 'homeless',
			address_no: '',
			subdistrict: 'หาดใหญ่',
			district: 'หาดใหญ่',
			province: 'สงขลา'
		});
		expect(result.success).toBe(true);
	});

	it('rejects homeless Residence with no address_no, no landmark, and incomplete geo', () => {
		const result = householdInputSchema.safeParse({
			label: 'ข้อมูลไม่ครบ',
			housing_type: 'homeless',
			address_no: null,
			residence_landmark: '',
			subdistrict: 'หาดใหญ่',
			district: null,
			province: 'สงขลา'
		});
		expect(result.success).toBe(false);
	});
});

describe('createHousehold', () => {
	it('stamps the household document correctly and parses pets, assets, and vehicles', () => {
		const h = createHousehold(
			{
				label: ' บ้านทองดี ',
				head_evacuee_id: 'evacuee:123',
				municipality_zone: 'zone_1',
				community: 'z1_c01',
				pets: [
					{
						species: 'dog',
						count: 2,
						notes: 'friendly',
						has_cage: true,
						image_url: 'http://image.png'
					}
				],
				assets: { description: 'สร้อยคอทองคำ', image_url: null },
				vehicles: [{ type: 'car', license_plate: 'กข 1234' }],
				notes: 'ใกล้ประตูทางออก',
				address_no: ' 123/45 ',
				village_no: ' หมู่ 2 ',
				subdistrict: ' หาดใหญ่ ',
				district: ' หาดใหญ่ ',
				province: ' สงขลา ',
				postal_code: ' 90110 '
			},
			ctx
		);

		expect(h._id.startsWith('household:')).toBe(true);
		expect(h.type).toBe('household');
		expect(h.schema_v).toBe(5);
		expect(h.status).toBe('arriving');
		expect(h.checkout_destination).toBeNull();
		expect(h.shelter_code).toBe('SH001');
		expect(h.created_by).toBe('staff1');
		expect(h.label).toBe('บ้านทองดี'); // trimmed
		expect(h.head_evacuee_id).toBe('evacuee:123');
		expect(h.municipality_zone).toBe('zone_1');
		expect(h.community).toBe('z1_c01');
		expect((h as unknown as { zone?: unknown }).zone).toBeUndefined();
		expect(h.pets).toEqual([
			{ species: 'dog', count: 2, notes: 'friendly', has_cage: true, image_url: 'http://image.png' }
		]);
		expect(h.assets).toEqual({ description: 'สร้อยคอทองคำ', image_url: null });
		expect(h.vehicles).toEqual([{ type: 'car', license_plate: 'กข 1234' }]);
		expect(h.notes).toBe('ใกล้ประตูทางออก');
		expect(h.address_no).toBe('123/45'); // trimmed
		expect(h.village_no).toBe('หมู่ 2'); // trimmed
		expect(h.subdistrict).toBe('หาดใหญ่'); // trimmed
		expect(h.district).toBe('หาดใหญ่'); // trimmed
		expect(h.province).toBe('สงขลา'); // trimmed
		expect(h.postal_code).toBe('90110'); // trimmed
		expect(isHousehold(h)).toBe(true);
	});

	it('sets omitted address fields to null to match schema', () => {
		const h = createHousehold(
			{
				label: 'บ้านเดียวดาย',
				head_evacuee_id: null,
				municipality_zone: null,
				community: null,
				pets: []
			},
			ctx
		);
		expect(h.address_no).toBeNull();
		expect(h.village_no).toBeNull();
		expect(h.subdistrict).toBeNull();
		expect(h.district).toBeNull();
		expect(h.province).toBeNull();
		expect(h.postal_code).toBeNull();
	});

	describe('migrateHouseholdV3ToV4', () => {
		it('performs lazy migration from v3 to v4 with defaults', () => {
			const v3Doc = {
				_id: 'household:123',
				type: 'household',
				schema_v: 3,
				label: 'บ้านเก่า',
				head_evacuee_id: null,
				pets: []
			};

			const migrated = migrateHouseholdV3ToV4(v3Doc);
			expect(migrated.schema_v).toBe(5);
			expect(migrated.status).toBe('checked_in'); // fallback default for existing active stays
			expect(migrated.checkout_destination).toBeNull();
			expect(migrated.vehicles).toEqual([]);
		});

		it('performs lazy migration from v2 to v4 converting vehicle object to vehicles array', () => {
			const v2Doc = {
				_id: 'household:123',
				type: 'household',
				schema_v: 2,
				label: 'บ้านเก่า',
				head_evacuee_id: null,
				vehicle: { type: 'car', license_plate: 'กข 1234' },
				pets: []
			};

			const migrated = migrateHouseholdV3ToV4(v2Doc);
			expect(migrated.schema_v).toBe(5);
			expect(migrated.status).toBe('checked_in');
			expect(migrated.checkout_destination).toBeNull();
			expect(migrated.vehicles).toEqual([{ type: 'car', license_plate: 'กข 1234' }]);
			// expect((migrated as any).vehicle).toBeUndefined();
			expect(migrated).not.toHaveProperty('vehicle');
		});

		it('performs lazy migration from v3 to v4 keeping empty vehicles array', () => {
			const v3Doc = {
				_id: 'household:123',
				type: 'household',
				schema_v: 3,
				label: 'บ้านเก่า',
				head_evacuee_id: null,
				vehicles: [],
				pets: []
			};

			const migrated = migrateHouseholdV3ToV4(v3Doc);
			expect(migrated.schema_v).toBe(5);
			expect(migrated.vehicles).toEqual([]);
			// expect((migrated as any).vehicle).toBeUndefined();
			expect(migrated).not.toHaveProperty('vehicle');
		});

		it('preserves existing status and destination if already present', () => {
			const activeDoc = {
				_id: 'household:123',
				type: 'household',
				schema_v: 4,
				label: 'บ้านใหม่',
				head_evacuee_id: null,
				status: 'pre_registered',
				checkout_destination: null,
				pets: []
			};

			const migrated = migrateHouseholdV3ToV4(activeDoc);
			expect(migrated.schema_v).toBe(5);
			expect(migrated.status).toBe('pre_registered');
		});
	});
});

describe('household membership invariant', () => {
	const makeEvacuee = (id: string, householdId: string | null) => ({
		...createEvacuee({ first_name: id, last_name: 'ทดสอบ', gender: 'other', phone: null }, ctx),
		_id: id,
		household_id: householdId
	});
	const makeHousehold = (id: string, status: 'checked_in' | 'checked_out' = 'checked_in') => ({
		...createHousehold({ label: id, head_evacuee_id: null, status }, ctx),
		_id: id
	});

	it('blocks moving the head away from an active household that has other members', () => {
		const household = {
			...makeHousehold('household:old'),
			head_evacuee_id: 'evacuee:1'
		};
		const target = makeHousehold('household:new');
		const head = makeEvacuee('evacuee:1', household._id);
		const sibling = makeEvacuee('evacuee:2', household._id);

		expect(
			checkEvacueeHouseholdConflict(head, target._id, [household, target], [head, sibling])
		).toMatchObject({ conflicted: true, householdId: household._id });
		expect(() =>
			assertEvacueeHouseholdAssignment(head, target._id, [household, target], [head, sibling])
		).toThrow(/ยังมีสมาชิกอื่นอยู่/);
	});

	it('allows a non-head to leave an active household that has other members (CR-106)', () => {
		const household = {
			...makeHousehold('household:old'),
			head_evacuee_id: 'evacuee:1'
		};
		const target = makeHousehold('household:new');
		const head = makeEvacuee('evacuee:1', household._id);
		const member = makeEvacuee('evacuee:2', household._id);

		expect(
			checkEvacueeHouseholdConflict(member, target._id, [household, target], [head, member])
		).toEqual({ conflicted: false });
		expect(() =>
			assertEvacueeHouseholdAssignment(member, target._id, [household, target], [head, member])
		).not.toThrow();
	});

	it('allows moving a solo member or a member from an inactive household', () => {
		const active = makeHousehold('household:active');
		const inactive = makeHousehold('household:inactive', 'checked_out');
		const target = makeHousehold('household:target');
		const solo = makeEvacuee('evacuee:solo', active._id);
		const historical = makeEvacuee('evacuee:historical', inactive._id);

		expect(checkEvacueeHouseholdConflict(solo, target._id, [active, target], [solo])).toEqual({
			conflicted: false
		});
		expect(
			checkEvacueeHouseholdConflict(historical, target._id, [inactive, target], [historical])
		).toEqual({ conflicted: false });
	});
});

describe('household status transitions', () => {
	it('allows forward transitions and rejects reopening terminal statuses', () => {
		expect(() => assertHouseholdStatusTransition('pre_registered', 'checked_in')).not.toThrow();
		expect(() => assertHouseholdStatusTransition('checked_in', 'checked_out')).not.toThrow();
		expect(() => assertHouseholdStatusTransition('checked_out', 'checked_in')).toThrow(
			/ไม่สามารถเปลี่ยนสถานะ/
		);
		expect(() => assertHouseholdStatusTransition('cancelled', 'arriving')).toThrow(
			/ไม่สามารถเปลี่ยนสถานะ/
		);
	});

	it('allows cancelling a pre-registered household (CR-029)', () => {
		expect(() => assertHouseholdStatusTransition('pre_registered', 'cancelled')).not.toThrow();
	});

	it('restricts the manual (free-form UI) transition table to non-side-effect-bound statuses', () => {
		expect(MANUAL_HOUSEHOLD_STATUS_TRANSITIONS.pre_registered).toEqual(['arriving']);
		expect(MANUAL_HOUSEHOLD_STATUS_TRANSITIONS.arriving).toEqual([]);
		expect(MANUAL_HOUSEHOLD_STATUS_TRANSITIONS.checked_in).toEqual([]);
		expect(MANUAL_HOUSEHOLD_STATUS_TRANSITIONS.checked_out).toEqual([]);
		expect(MANUAL_HOUSEHOLD_STATUS_TRANSITIONS.cancelled).toEqual([]);
	});
});

describe('assertCheckoutDestination', () => {
	it('rejects a missing destination', () => {
		expect(() => assertCheckoutDestination(null)).toThrow(/ต้องระบุปลายทาง/);
		expect(() => assertCheckoutDestination(undefined)).toThrow(/ต้องระบุปลายทาง/);
	});

	it('allows returned_home with no extra fields', () => {
		expect(() => assertCheckoutDestination({ type: 'returned_home' })).not.toThrow();
	});

	it('requires destination_name for transferred_shelter / referred_facility', () => {
		expect(() => assertCheckoutDestination({ type: 'transferred_shelter' })).toThrow(
			/ชื่อ\/รหัสสถานที่ปลายทาง/
		);
		expect(() => assertCheckoutDestination({ type: 'referred_facility' })).toThrow(
			/ชื่อ\/รหัสสถานที่ปลายทาง/
		);
		expect(() =>
			assertCheckoutDestination({ type: 'transferred_shelter', destination_name: 'ศูนย์ B' })
		).not.toThrow();
	});

	it('requires notes for "other"', () => {
		expect(() => assertCheckoutDestination({ type: 'other' })).toThrow(/หมายเหตุ/);
		expect(() =>
			assertCheckoutDestination({ type: 'other', notes: 'ญาตินำกลับไปดูแลเอง' })
		).not.toThrow();
	});
});

describe('matchesEvacueeSearch', () => {
	const evacuee = createEvacuee(
		{ first_name: 'สมชาย', last_name: 'ใจดี', gender: 'male', phone: '0812345678' },
		ctx
	);

	it('returns true for an empty/blank query', () => {
		expect(matchesEvacueeSearch(evacuee, '')).toBe(true);
		expect(matchesEvacueeSearch(evacuee, '   ')).toBe(true);
	});

	it('matches by first name, last name, full name, and phone digits', () => {
		expect(matchesEvacueeSearch(evacuee, 'สมชาย')).toBe(true);
		expect(matchesEvacueeSearch(evacuee, 'ใจดี')).toBe(true);
		expect(matchesEvacueeSearch(evacuee, 'สมชาย ใจดี')).toBe(true);
		expect(matchesEvacueeSearch(evacuee, '0812345678')).toBe(true);
		expect(matchesEvacueeSearch(evacuee, 'ไม่มีตัวตน')).toBe(false);
	});

	it('defaults to including search_excluded evacuees (internal staff search)', () => {
		const excluded = { ...evacuee, privacy: { search_excluded: true } };
		expect(matchesEvacueeSearch(excluded, 'สมชาย')).toBe(true);
		expect(matchesEvacueeSearch(excluded, 'สมชาย', { isPublicSearch: false })).toBe(true);
	});

	it('excludes search_excluded evacuees only when isPublicSearch is true', () => {
		const excluded = { ...evacuee, privacy: { search_excluded: true } };
		expect(matchesEvacueeSearch(excluded, 'สมชาย', { isPublicSearch: true })).toBe(false);

		const included = { ...evacuee, privacy: { search_excluded: false } };
		expect(matchesEvacueeSearch(included, 'สมชาย', { isPublicSearch: true })).toBe(true);
	});

	it('an empty query still short-circuits to true even when search_excluded + isPublicSearch', () => {
		const excluded = { ...evacuee, privacy: { search_excluded: true } };
		expect(matchesEvacueeSearch(excluded, '', { isPublicSearch: true })).toBe(true);
	});
});
