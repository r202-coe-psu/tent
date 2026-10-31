import { describe, expect, it } from 'vitest';
import { PASSWORD_RULES, passwordPolicyError } from './password-schema';

describe('passwordPolicyError (#1045)', () => {
	it('passes a password that meets every rule', () => {
		expect(passwordPolicyError('Shelter-2569x')).toBeNull();
	});

	it('lists every unmet rule in Thai', () => {
		expect(passwordPolicyError('abc')).toBe(
			'รหัสผ่านต้องมี: อย่างน้อย 10 ตัวอักษร, ตัวพิมพ์ใหญ่ (A-Z), ตัวเลข (0-9), อักขระพิเศษ เช่น !@#$'
		);
	});

	it('names only the missing rule', () => {
		expect(passwordPolicyError('Shelter2569x')).toBe('รหัสผ่านต้องมี: อักขระพิเศษ เช่น !@#$');
	});

	it('trims before checking, as the server stores it', () => {
		expect(passwordPolicyError('  Ab1!  ')).toContain('อย่างน้อย 10 ตัวอักษร');
	});

	it('marks each rule for the checklist', () => {
		expect(PASSWORD_RULES.filter((rule) => rule.test('ABCDEFGHIJ')).map((r) => r.key)).toEqual([
			'length',
			'upper'
		]);
	});
});
