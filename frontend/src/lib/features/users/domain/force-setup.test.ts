import { describe, expect, it } from 'vitest';
import { forceSetupFieldErrors } from './force-setup';

const valid = {
	questionId: 'high_school',
	answer: 'โรงเรียน',
	newPassword: 'Shelter-2569x',
	confirmPassword: 'Shelter-2569x',
	mustChangePassword: true
};

describe('forceSetupFieldErrors (#1065)', () => {
	it('has no errors for a complete, valid form', () => {
		expect(forceSetupFieldErrors(valid)).toEqual({});
	});

	it('flags every empty required field at once', () => {
		expect(
			forceSetupFieldErrors({
				questionId: '',
				answer: '  ',
				newPassword: '',
				confirmPassword: '',
				mustChangePassword: true
			})
		).toEqual({
			question: 'กรุณาเลือกคำถามความปลอดภัย',
			answer: 'กรุณากรอกคำตอบความปลอดภัย',
			newPassword: 'กรุณากรอกรหัสผ่านใหม่'
		});
	});

	it('lists every unmet password rule in Thai, as the server does', () => {
		expect(
			forceSetupFieldErrors({ ...valid, newPassword: 'abc', confirmPassword: 'abc' }).newPassword
		).toBe(
			'รหัสผ่านต้องมี: อย่างน้อย 10 ตัวอักษร, ตัวพิมพ์ใหญ่ (A-Z), ตัวเลข (0-9), อักขระพิเศษ เช่น !@#$'
		);
	});

	it('trims before checking the rules, as the server stores it', () => {
		expect(
			forceSetupFieldErrors({ ...valid, newPassword: ' Ab1! ', confirmPassword: ' Ab1! ' })
				.newPassword
		).toContain('อย่างน้อย 10 ตัวอักษร');
	});

	it('flags a confirmation that does not match', () => {
		expect(forceSetupFieldErrors({ ...valid, confirmPassword: 'Other-2569x' })).toEqual({
			confirmPassword: 'รหัสผ่านใหม่และการยืนยันรหัสผ่านไม่ตรงกัน'
		});
	});

	it('lets an existing user keep the old password (no new password, no password errors)', () => {
		expect(
			forceSetupFieldErrors({
				...valid,
				newPassword: '',
				confirmPassword: '',
				mustChangePassword: false
			})
		).toEqual({});
	});

	it('rejects an unknown question id', () => {
		expect(forceSetupFieldErrors({ ...valid, questionId: 'nope' }).question).toBe(
			'กรุณาเลือกคำถามความปลอดภัย'
		);
	});
});
