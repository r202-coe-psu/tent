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
