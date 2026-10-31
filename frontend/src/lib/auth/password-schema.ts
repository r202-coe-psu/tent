/**
 * Shared password Zod schema — client-side validation (mirrors server policy).
 *
 * Rules:
 * - At least 10 characters
 * - At least one uppercase letter (A-Z)
 * - At least one lowercase letter (a-z)
 * - At least one digit (0-9)
 * - At least one special character
 */

import { z } from 'zod';

export const PASSWORD_MIN_LENGTH = 10;

export const passwordSchema = z
	.string()
	.min(PASSWORD_MIN_LENGTH, `รหัสผ่านต้องมีอย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`)
	.regex(/[A-Z]/, 'รหัสผ่านต้องมีตัวพิมพ์ใหญ่ (A-Z) อย่างน้อย 1 ตัว')
	.regex(/[a-z]/, 'รหัสผ่านต้องมีตัวพิมพ์เล็ก (a-z) อย่างน้อย 1 ตัว')
	.regex(/[0-9]/, 'รหัสผ่านต้องมีตัวเลข (0-9) อย่างน้อย 1 ตัว')
	.regex(/[^A-Za-z0-9]/, 'รหัสผ่านต้องมีอักขระพิเศษ อย่างน้อย 1 ตัว');

/** One rule of the password policy, worded for a checklist under the field (#1045). */
export interface PasswordRule {
	key: 'length' | 'upper' | 'lower' | 'digit' | 'special';
	label: string;
	test: (password: string) => boolean;
}

export const PASSWORD_RULES: readonly PasswordRule[] = [
	{
		key: 'length',
		label: `อย่างน้อย ${PASSWORD_MIN_LENGTH} ตัวอักษร`,
		test: (p) => p.length >= PASSWORD_MIN_LENGTH
	},
	{ key: 'upper', label: 'ตัวพิมพ์ใหญ่ (A-Z)', test: (p) => /[A-Z]/.test(p) },
	{ key: 'lower', label: 'ตัวพิมพ์เล็ก (a-z)', test: (p) => /[a-z]/.test(p) },
	{ key: 'digit', label: 'ตัวเลข (0-9)', test: (p) => /[0-9]/.test(p) },
	{ key: 'special', label: 'อักขระพิเศษ เช่น !@#$', test: (p) => /[^A-Za-z0-9]/.test(p) }
];

/**
 * The Thai message for a password that breaks the policy, listing every unmet rule, or null when
 * it passes. The password is trimmed first, as the server stores it. Shared by the server policy
 * (`$lib/server/password-policy`) so the toast reads the same on both sides.
 */
export function passwordPolicyError(raw: string): string | null {
	const password = raw.trim();
	const missing = PASSWORD_RULES.filter((rule) => !rule.test(password)).map((rule) => rule.label);
	return missing.length > 0 ? `รหัสผ่านต้องมี: ${missing.join(', ')}` : null;
}
