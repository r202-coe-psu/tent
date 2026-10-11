import { describe, expect, it } from 'vitest';
import {
	blankUnifiedMember,
	unifiedRegistrationInputSchema,
	type UnifiedRegistrationInput
} from './unified-registration';
import {
	registrationIssueKey,
	stillInvalidEntries,
	toRegistrationEntries,
	toRegistrationFieldErrors,
	type RegistrationIssue
} from './registration-validation';

const issue = (path: (string | number)[], message: string): RegistrationIssue => ({
	path,
	message
});

function payload(): UnifiedRegistrationInput {
	return {
		members: [
			{
				...blankUnifiedMember(),
				first_name: 'ทดสอบ',
				gender: 'male',
				phone: '0899999999'
			}
		],
		household: {
			housing_type: 'owned_house',
			address_no: '1',
			subdistrict: 'คอหงส์',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90110'
		}
	} as UnifiedRegistrationInput;
}

describe('registrationIssueKey', () => {
	it('keys member, emergency, household, pet and batch issues by field', () => {
		expect(registrationIssueKey(issue(['members', 1, 'first_name'], 'x'))).toBe(
			'members.1.first_name'
		);
		expect(registrationIssueKey(issue(['members', 0, 'person_id', 'number'], 'x'))).toBe(
			'members.0.person_id'
		);
		expect(registrationIssueKey(issue(['members', 0, 'emergency_contact', 'phone'], 'x'))).toBe(
			'members.0.emergency_contact.phone'
		);
		expect(registrationIssueKey(issue(['household', 'address_no'], 'x'))).toBe(
			'household.address_no'
		);
		expect(registrationIssueKey(issue(['household', 'pets', 2, 'notes'], 'x'))).toBe(
			'household.pets.2'
		);
		expect(registrationIssueKey(issue(['members'], 'x'))).toBe('members');
		expect(registrationIssueKey(issue([], 'no member selected'))).toBe('form:no member selected');
	});
});

describe('toRegistrationFieldErrors', () => {
	it('shows the first message per field and lists every distinct message once', () => {
		const entries = toRegistrationEntries([
			issue(['members', 0, 'first_name'], 'กรุณากรอกชื่อ'),
			issue(['members', 0, 'first_name'], 'ชื่อสั้นเกินไป'),
			issue(['members', 0, 'first_name'], 'กรุณากรอกชื่อ'),
			issue(['members', 1, 'first_name'], 'กรุณากรอกชื่อ'),
			issue(['members', 0, 'emergency_contact', 'name'], 'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน'),
			issue(['household', 'address_no'], 'กรุณากรอกบ้านเลขที่'),
			issue(['household', 'pets', 0, 'notes'], 'กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ'),
			issue(['members'], 'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง'),
			issue([], '')
		]);
		const errors = toRegistrationFieldErrors(entries);

		expect(errors.members[0]).toEqual({
			first_name: 'กรุณากรอกชื่อ',
			'emergency_contact.name': 'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน'
		});
		expect(errors.members[1]).toEqual({ first_name: 'กรุณากรอกชื่อ' });
		expect(errors.household).toEqual({ address_no: 'กรุณากรอกบ้านเลขที่' });
		expect(errors.pets).toEqual({ 0: 'กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ' });
		expect(errors.membersLimit).toBe('ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง');
		expect(errors.messages).toEqual([
			'กรุณากรอกชื่อ',
			'ชื่อสั้นเกินไป',
			'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน',
			'กรุณากรอกบ้านเลขที่',
			'กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ',
			'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง'
		]);
	});
});

describe('stillInvalidEntries', () => {
	const shown = toRegistrationEntries([
		issue(['members', 0, 'first_name'], 'กรุณากรอกชื่อ'),
		issue(['members', 0, 'phone'], 'เบอร์ไม่ถูกต้อง')
	]);

	it('drops the field that became valid and keeps the others', () => {
		const live = toRegistrationEntries([issue(['members', 0, 'phone'], 'เบอร์ไม่ถูกต้อง')]);
		expect(stillInvalidEntries(shown, live).map((e) => e.key)).toEqual(['members.0.phone']);
	});

	it('never adds a field that was not reported by the submit', () => {
		const live = toRegistrationEntries([
			issue(['members', 0, 'first_name'], 'กรุณากรอกชื่อ'),
			issue(['members', 0, 'age'], 'อายุต้องไม่เกิน 150 ปี')
		]);
		expect(stillInvalidEntries(shown, live).map((e) => e.key)).toEqual(['members.0.first_name']);
	});

	it('carries the live message when the problem changes while typing', () => {
		const live = toRegistrationEntries([issue(['members', 0, 'phone'], 'ยังไม่ครบ 10 หลัก')]);
		expect(stillInvalidEntries(shown, live)[0]?.message).toBe('ยังไม่ครบ 10 หลัก');
	});
});

describe('schema issue paths the form depends on', () => {
	it('reports an incomplete emergency contact per field', () => {
		const input = payload();
		input.members[0]!.emergency_contact = { name: '', phone: '12', relation: '' };
		const result = unifiedRegistrationInputSchema.safeParse(input);
		expect(result.success).toBe(false);
		const keys = toRegistrationEntries(result.error!.issues).map((e) => e.key);
		expect(keys).toEqual(
			expect.arrayContaining([
				'members.0.emergency_contact.name',
				'members.0.emergency_contact.phone',
				'members.0.emergency_contact.relation'
			])
		);
	});

	it('reports more than 20 members at the batch level', () => {
		const input = payload();
		input.members = Array.from({ length: 21 }, () => ({ ...input.members[0]! }));
		const result = unifiedRegistrationInputSchema.safeParse(input);
		expect(result.success).toBe(false);
		const errors = toRegistrationFieldErrors(toRegistrationEntries(result.error!.issues));
		expect(errors.membersLimit).toBe('ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง');
	});

	it('reports a missing「อื่นๆ」pet species on that pet card', () => {
		const input = payload();
		input.household.pets = [{ species: 'other', count: 1, notes: '' }];
		const result = unifiedRegistrationInputSchema.safeParse(input);
		expect(result.success).toBe(false);
		const errors = toRegistrationFieldErrors(toRegistrationEntries(result.error!.issues));
		expect(errors.pets[0]).toBe('กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ');
	});

	it('reports a missing address on household.address_no', () => {
		const input = payload();
		input.household.province = '';
		const result = unifiedRegistrationInputSchema.safeParse(input);
		expect(result.success).toBe(false);
		const errors = toRegistrationFieldErrors(toRegistrationEntries(result.error!.issues));
		expect(errors.household.address_no).toBe('กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล');
	});
});
