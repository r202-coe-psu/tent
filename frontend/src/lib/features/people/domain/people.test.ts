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
	canCancelEvacueePreRegistration,
	canCancelHouseholdPreRegistration,
	CHECK_IN_ELIGIBLE_STATUSES,
	CHECK_OUT_ELIGIBLE_STATUSES,
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
	householdPreRegisterEvacueeSchema,
	householdPreRegisterAddressFormSchema,
	householdPostArrivalAddressFormSchema,
	evacueePersonalEditFormSchema,
	evacueeHealthEditFormSchema
} from './people';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff1' };

describe('createEvacuee', () => {
	it('stamps the envelope and applies spec defaults', () => {
		const e = createEvacuee(
			{ first_name: '  สมชาย ', last_name: 'ใจดี', gender: 'male', phone: '0812345678' },
			ctx
		);
		expect(e._id.startsWith('evacuee:')).toBe(true);
		expect(e.type).toBe('evacuee');
		expect(e.schema_v).toBe(8);
		expect(e.shelter_code).toBe('SH001');
		expect(e.created_by).toBe('staff1');
		expect(e.created_at).toBe(e.updated_at);
		expect(e.first_name).toBe('สมชาย'); // trimmed
		expect(e.privacy).toEqual({ search_excluded: false });
		expect(e.current_stay.status).toBe('pre_registered');
		expect(e.country).toBe('THAILAND');
		expect(e.special_needs).toEqual([]);
		expect(e.registered_via).toBe('app');
		expect(isEvacuee(e)).toBe(true);
	});

	it('creates draft evacuee from card snapshot with schema_v 8 and status draft', () => {
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
		const draft = createDraftEvacueeFromCard(card, ctx);
		expect(draft._id.startsWith('evacuee:')).toBe(true);
		expect(draft.type).toBe('evacuee');
		expect(draft.schema_v).toBe(8);
		expect(draft.first_name).toBe('สมศักดิ์');
		expect(draft.last_name).toBe('รักชาติ');
		expect(draft.birth_year).toBe(2533);
		expect(draft.age).toBe(36);
		expect(draft.current_stay.status).toBe('draft');
		expect(draft.household_id).toBeNull();
		expect(draft.registered_via).toBe('kiosk');
		expect(draft.person_id?.number).toBe('1234567890123');
		expect(draft.card_snapshot?.station_name).toBe('จุดสแกน Kiosk 1');
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

	it('allows check_in from eligible stay statuses only', () => {
		const statuses = [
			'draft',
			'pre_registered',
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
			'draft',
			'pre_registered',
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

	it('allows check_in from eligible stay statuses only', () => {
		const e = createEvacuee({ first_name: 'ก', last_name: 'ข', gender: 'male', phone: null }, ctx);
		expect(canCheckInEvacuee(e)).toBe(true); // pre_registered
		expect(CHECK_IN_ELIGIBLE_STATUSES).toContain('draft');
		expect(CHECK_IN_ELIGIBLE_STATUSES).toContain('pre_registered');
		expect(CHECK_OUT_ELIGIBLE_STATUSES).toEqual(['active']);

		const active = {
			...e,
			current_stay: { status: 'active' as const, zone: 'Z1', since: e.current_stay.since }
		};
		expect(canCheckInEvacuee(active)).toBe(false);
		expect(canCheckOutEvacuee(active)).toBe(true);
	});
});

describe('createScreening', () => {
	it('defaults the screening time to now when omitted', () => {
		const s = createScreening({ evacuee_id: 'evacuee:x', track: 'fast_track' }, ctx);
		expect(s.type).toBe('screening');
		expect(s.needs_referral).toBe(false);
		expect(s.symptoms).toEqual([]);
		expect(typeof s.screened_at).toBe('string');
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
		expect(h.schema_v).toBe(4);
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
			expect(migrated.schema_v).toBe(4);
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
			expect(migrated.schema_v).toBe(4);
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
			expect(migrated.schema_v).toBe(4);
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
			expect(migrated.schema_v).toBe(4);
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

	it('blocks moving a member away from an active household that has other members', () => {
		const household = makeHousehold('household:old');
		const target = makeHousehold('household:new');
		const member = makeEvacuee('evacuee:1', household._id);
		const sibling = makeEvacuee('evacuee:2', household._id);

		expect(
			checkEvacueeHouseholdConflict(member, target._id, [household, target], [member, sibling])
		).toMatchObject({ conflicted: true, householdId: household._id });
		expect(() =>
			assertEvacueeHouseholdAssignment(member, target._id, [household, target], [member, sibling])
		).toThrow(/ยังมีสมาชิกอื่นอยู่/);
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
