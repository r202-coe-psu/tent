/**
 * CR-148 — pre-register validation hardening + religion/disability "other" + dorm address.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
	PETS_MAX_COUNT,
	ageMatchesBirthYear,
	composeDormAddress,
	createEvacuee,
	currentBEYear,
	dormFieldsFor,
	isBirthYearBEValid,
	memberExtrasFor,
	nationalIdIssue,
	refineMemberRules,
	shouldCheckNationalId
} from './people';
import { unifiedRegistrationInputSchema } from './unified-registration';

const VALID_ID = '1101700207030';
const BAD_CHECK_DIGIT = '1101700207031';

function issuesFor(member: Parameters<typeof refineMemberRules>[0]): string[] {
	const result = z
		.any()
		.superRefine((value, ctx) => refineMemberRules(value, ctx))
		.safeParse(member);
	return result.success ? [] : result.error.issues.map((i) => i.message);
}

function member(over: Record<string, unknown> = {}) {
	return {
		first_name: 'สมชาย',
		last_name: 'ใจดี',
		gender: 'male' as const,
		phone: '0812345678',
		country: 'THAILAND',
		religion: 'buddhist' as const,
		person_id: { cardType: 'national_id' as const, number: VALID_ID },
		vulnerable_groups: [],
		special_needs: [],
		...over
	};
}

function household(over: Record<string, unknown> = {}) {
	return {
		housing_type: 'owned_house' as const,
		address_no: '12/3',
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		pets: [],
		vehicles: [],
		...over
	};
}

describe('national ID (FR-01 / FR-03)', () => {
	it('requires 13 digits and a valid check digit', () => {
		expect(nationalIdIssue(VALID_ID)).toBeNull();
		expect(nationalIdIssue(BAD_CHECK_DIGIT)).toMatch(/ไม่ถูกต้อง/);
		expect(nationalIdIssue('110170020703')).toMatch(/13 หลัก/);
	});

	it('checks only new or changed national-id numbers', () => {
		expect(shouldCheckNationalId('national_id', BAD_CHECK_DIGIT)).toBe(true);
		expect(shouldCheckNationalId('national_id', BAD_CHECK_DIGIT, BAD_CHECK_DIGIT)).toBe(false);
		expect(shouldCheckNationalId('national_id', VALID_ID, BAD_CHECK_DIGIT)).toBe(true);
		expect(shouldCheckNationalId('passport', 'AB1234567')).toBe(false);
		expect(shouldCheckNationalId('national_id', '')).toBe(false);
	});

	it('rejects a bad check digit on a new member but not on an unchanged legacy one', () => {
		const fresh = member({ person_id: { cardType: 'national_id', number: BAD_CHECK_DIGIT } });
		expect(issuesFor(fresh)).toContain('เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)');
		expect(issuesFor({ ...fresh, original_person_number: BAD_CHECK_DIGIT })).toEqual([]);
	});
});

describe('birth year / age (FR-04 – FR-06)', () => {
	it('accepts 4-digit years from age 150 up to this year', () => {
		expect(isBirthYearBEValid(currentBEYear() - 150)).toBe(true);
		expect(isBirthYearBEValid(currentBEYear())).toBe(true);
		expect(isBirthYearBEValid(currentBEYear() - 151)).toBe(false);
		expect(isBirthYearBEValid(currentBEYear() + 1)).toBe(false);
		expect(isBirthYearBEValid(253)).toBe(false);
	});

	it('allows age and birth year to differ by at most one year', () => {
		const by = currentBEYear() - 40;
		expect(ageMatchesBirthYear(40, by)).toBe(true);
		expect(ageMatchesBirthYear(39, by)).toBe(true);
		expect(ageMatchesBirthYear(41, by)).toBe(true);
		expect(ageMatchesBirthYear(42, by)).toBe(false);
		expect(issuesFor(member({ birth_year: by, age: 45 }))).toContain('อายุไม่ตรงกับปีเกิด');
	});
});

describe('religion / disability other (FR-12 – FR-14)', () => {
	it('requires religion_other when religion is other', () => {
		expect(issuesFor(member({ religion: 'other' }))).toContain('กรุณาระบุศาสนา');
		expect(issuesFor(member({ religion: 'other', religion_other: 'ซิกข์' }))).toEqual([]);
	});

	it('persists extras only when their parent choice is selected', () => {
		expect(
			memberExtrasFor({
				religion: 'other',
				religion_other: ' ซิกข์ ',
				vulnerable_groups: ['disability_other'],
				disability_other_detail: ' ขาเทียม '
			})
		).toEqual({ religion_other: 'ซิกข์', disability_other_detail: 'ขาเทียม' });
		expect(
			memberExtrasFor({
				religion: 'buddhist',
				religion_other: 'ซิกข์',
				vulnerable_groups: [],
				disability_other_detail: 'ขาเทียม'
			})
		).toEqual({ religion_other: null, disability_other_detail: null });
	});

	it('createEvacuee stamps schema_v 11 with the extras', () => {
		const e = createEvacuee(
			{ ...member({ religion: 'other', religion_other: 'ซิกข์' }), status: 'arriving' },
			{ shelterCode: 'SH001', createdBy: 'test' }
		);
		expect(e.schema_v).toBe(13);
		expect(e.religion_other).toBe('ซิกข์');
		expect(e.disability_other_detail).toBeNull();
	});
});

describe('dorm address (FR-15 – FR-17)', () => {
	it('composes a readable address_no and keeps dorm fields for apartment_dorm', () => {
		const out = dormFieldsFor({
			housing_type: 'apartment_dorm',
			dorm_name: 'หอสุขใจ',
			dorm_building: 'B',
			dorm_floor: '3',
			dorm_room: '305'
		});
		expect(out.address_no).toBe('305 หอสุขใจ อาคาร B ชั้น 3');
		expect(out.dorm_room).toBe('305');
		expect(composeDormAddress({ dorm_name: 'หอสุขใจ', dorm_room: '12' })).toBe('12 หอสุขใจ');
	});

	it('clears dorm fields for other housing types and address_no for homeless', () => {
		expect(dormFieldsFor({ housing_type: 'owned_house', address_no: '9', dorm_room: '1' })).toEqual(
			{
				dorm_name: null,
				dorm_building: null,
				dorm_floor: null,
				dorm_room: null,
				address_no: '9'
			}
		);
		expect(dormFieldsFor({ housing_type: 'homeless', address_no: '9' }).address_no).toBeNull();
	});

	it('requires dorm name and room in the registration form', () => {
		const result = unifiedRegistrationInputSchema.safeParse({
			members: [member()],
			household: household({ housing_type: 'apartment_dorm', address_no: null })
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			const messages = result.error.issues.map((i) => i.message);
			expect(messages).toContain('กรุณากรอกชื่อหอพัก');
			expect(messages).toContain('กรุณากรอกเลขห้อง');
		}
	});

	it('accepts a complete dorm and writes the composed address_no', () => {
		const result = unifiedRegistrationInputSchema.safeParse({
			members: [member()],
			household: household({
				housing_type: 'apartment_dorm',
				address_no: null,
				dorm_name: 'หอสุขใจ',
				dorm_room: '305'
			})
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.household.address_no).toBe('305 หอสุขใจ');
	});
});

describe('pets (FR-08)', () => {
	it(`caps animals at ${PETS_MAX_COUNT} per household`, () => {
		const pets = (n: number) => Array.from({ length: n }, () => ({ species: 'dog', count: 1 }));
		expect(
			unifiedRegistrationInputSchema.safeParse({
				members: [member()],
				household: household({ pets: pets(PETS_MAX_COUNT) })
			}).success
		).toBe(true);
		expect(
			unifiedRegistrationInputSchema.safeParse({
				members: [member()],
				household: household({ pets: [{ species: 'dog', count: PETS_MAX_COUNT + 1 }] })
			}).success
		).toBe(false);
	});
});

describe('phone +66 (FR-09)', () => {
	it('stores +66 member phones as local digits', () => {
		const result = unifiedRegistrationInputSchema.safeParse({
			members: [member({ phone: '+66 81-234-5678' })],
			household: household()
		});
		expect(result.success).toBe(true);
		if (result.success) expect(result.data.members[0]?.phone).toBe('0812345678');
	});
});
