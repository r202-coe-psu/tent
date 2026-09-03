import { describe, it, expect } from 'vitest';
import { zod4 } from 'sveltekit-superforms/adapters';
import {
	createUserSchema,
	editUserSchema,
	usernameSchema,
	phoneSchema,
	securityQuestionSetupSchema,
	forgotPasswordVerifySchema
} from './schema';

const validPassword = 'SecurePass1!';

describe('phoneSchema and usernameSchema', () => {
	it('accepts valid 10-digit Thai mobile numbers', () => {
		expect(phoneSchema.safeParse('0812345678').success).toBe(true);
		expect(phoneSchema.safeParse('0987654321').success).toBe(true);
		expect(phoneSchema.safeParse('0612345678').success).toBe(true);
	});

	it('rejects invalid phone numbers', () => {
		expect(phoneSchema.safeParse('12345').success).toBe(false);
		expect(phoneSchema.safeParse('081234567A').success).toBe(false);
	});

	it('accepts alphanumeric username (for SA) and phone numbers for username', () => {
		expect(usernameSchema.safeParse('sa01').success).toBe(true);
		expect(usernameSchema.safeParse('admin').success).toBe(true);
		expect(usernameSchema.safeParse('0812345678').success).toBe(true);
		expect(usernameSchema.safeParse('ab').success).toBe(false); // < 3 chars
	});
});

describe('createUserSchema', () => {
	it('accepts a system_admin grant without a shelter', () => {
		const parsed = createUserSchema.parse({
			username: 'sa02',
			password: validPassword,
			display_name: 'ผู้ดูแลระบบ',
			personnel_type: 'staff',
			organization: 'กรมป้องกันและบรรเทาสาธารณภัย',
			phone: '0812345678',
			capabilities: ['system_admin']
		});
		expect(parsed.capabilities).toContain('system_admin');
		expect(parsed.shelter_id).toBeUndefined();
	});

	it('accepts a staff with multiple capabilities in a shelter and required organization', () => {
		const parsed = createUserSchema.parse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมชาย ใจดี',
			personnel_type: 'staff',
			organization: 'มูลนิธิกระจกเงา',
			phone: '0812345678',
			position: 'เจ้าหน้าที่ทะเบียน',
			email: 'somchai@example.com',
			capabilities: ['registration_staff', 'triage_staff'],
			shelter_id: 'SH001'
		});
		expect(parsed.capabilities).toEqual(['registration_staff', 'triage_staff']);
		expect(parsed.shelter_id).toBe('SH001');
		expect(parsed.organization).toBe('มูลนิธิกระจกเงา');
	});

	it('accepts multi-shelter compound assignments', () => {
		const parsed = createUserSchema.parse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมชาย ใจดี',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0812345678',
			assignments: [
				{ shelter_code: 'SH001', capabilities: ['registration_staff'] },
				{ shelter_code: 'SH002', capabilities: ['medical_staff', 'warehouse_staff'] }
			]
		});
		expect(parsed.assignments).toHaveLength(2);
	});

	it('rejects duplicate shelters in assignments', () => {
		const result = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมชาย ใจดี',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0812345678',
			assignments: [
				{ shelter_code: 'SH001', capabilities: ['registration_staff'] },
				{ shelter_code: 'SH001', capabilities: ['medical_staff'] }
			]
		});
		expect(result.success).toBe(false);
	});

	it('accepts is_system_admin without assignments', () => {
		const parsed = createUserSchema.parse({
			username: 'sa02',
			password: validPassword,
			display_name: 'ผู้ดูแลระบบ',
			personnel_type: 'staff',
			organization: 'ส่วนกลาง',
			phone: '0812345678',
			is_system_admin: true
		});
		expect(parsed.is_system_admin).toBe(true);
	});

	it('requires organization for staff', () => {
		const result = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมชาย ใจดี',
			personnel_type: 'staff',
			organization: '',
			phone: '0812345678',
			capabilities: ['registration_staff'],
			shelter_id: 'SH001'
		});
		expect(result.success).toBe(false);
	});

	it('allows empty/omitted organization for volunteer', () => {
		const result = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมหญิง รักดี',
			personnel_type: 'volunteer',
			phone: '0812345678',
			capabilities: ['registration_staff'],
			shelter_id: 'SH001',
			volunteer_id: 'volunteer:01J6M78ABCDEF'
		});
		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.volunteer_id).toBe('volunteer:01J6M78ABCDEF');
		}
	});

	it('validates duty window if present', () => {
		const valid = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมหญิง รักดี',
			personnel_type: 'volunteer',
			phone: '0812345678',
			capabilities: ['registration_staff'],
			shelter_id: 'SH001',
			duty_window: {
				start_ts: '2026-09-01T08:00:00.000Z',
				end_ts: '2026-09-01T16:00:00.000Z'
			}
		});
		expect(valid.success).toBe(true);

		const invalid = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'สมหญิง รักดี',
			personnel_type: 'volunteer',
			phone: '0812345678',
			capabilities: ['registration_staff'],
			shelter_id: 'SH001',
			duty_window: {
				start_ts: '2026-09-01T16:00:00.000Z',
				end_ts: '2026-09-01T08:00:00.000Z'
			}
		});
		expect(invalid.success).toBe(false);
	});

	it('rejects an unknown capability', () => {
		const result = createUserSchema.safeParse({
			username: '0812345678',
			password: validPassword,
			display_name: 'เจ้าหน้าที่',
			personnel_type: 'staff',
			organization: 'ปภ.',
			phone: '0812345678',
			capabilities: ['_admin' as unknown as 'registration_staff'],
			shelter_id: 'SH001'
		});
		expect(result.success).toBe(false);
	});

	it('creates zod4 adapter for superforms without SchemaError', () => {
		expect(() => zod4(createUserSchema)).not.toThrow();
	});
});

describe('editUserSchema', () => {
	it('allows an empty password (unchanged)', () => {
		const parsed = editUserSchema.parse({
			username: 'sa02',
			password: '',
			display_name: 'ผู้ดูแลระบบ',
			personnel_type: 'staff',
			organization: 'ส่วนกลาง',
			phone: '0812345678',
			capabilities: ['system_admin']
		});
		expect(parsed.password).toBe('');
	});

	it('creates zod4 adapter for superforms without SchemaError', () => {
		expect(() => zod4(editUserSchema)).not.toThrow();
	});
});

describe('securityQuestionSetupSchema & forgotPasswordVerifySchema', () => {
	it('validates security question setup', () => {
		const parsed = securityQuestionSetupSchema.parse({
			question_id: 'high_school',
			answer: 'สวนกุหลาบวิทยาลัย'
		});
		expect(parsed.question_id).toBe('high_school');
		expect(parsed.answer).toBe('สวนกุหลาบวิทยาลัย');

		expect(
			securityQuestionSetupSchema.safeParse({
				question_id: 'invalid_id',
				answer: '123'
			}).success
		).toBe(false);
	});

	it('validates forgot password verify request', () => {
		const parsed = forgotPasswordVerifySchema.parse({
			phone: '0812345678',
			question_id: 'high_school',
			answer: 'สวนกุหลาบวิทยาลัย',
			new_password: validPassword
		});
		expect(parsed.phone).toBe('0812345678');
		expect(parsed.new_password).toBe(validPassword);
	});
});
