import { z } from 'zod';

/** Canonical Thai phone form (`0XXXXXXXXX`) — apply before hashing or storing a volunteer phone. */
export function normalizePhone(value: string): string {
	const digits = value.replace(/[\s\-()]/g, '');
	if (digits.startsWith('+66')) return `0${digits.slice(3)}`;
	if (digits.startsWith('66') && digits.length >= 11) return `0${digits.slice(2)}`;
	return digits;
}

export const VOLUNTEER_PHONE_MESSAGE = 'เบอร์มือถือต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0';

/** True when `value` normalises to a 10-digit mobile (`^0\d{9}$`). */
export function isVolunteerMobile(value: string | null | undefined): boolean {
	return /^0\d{9}$/.test(normalizePhone(value ?? ''));
}

/** The single volunteer phone rule (#951): outputs the normalised 10-digit mobile. */
export const volunteerMobileSchema = z
	.string()
	.transform((value) => normalizePhone(value.trim()))
	.pipe(z.string().regex(/^0\d{9}$/, VOLUNTEER_PHONE_MESSAGE));

/** Same rule, but blank/null/undefined is allowed and becomes `null`. */
export const optionalVolunteerMobileSchema = z
	.string()
	.nullish()
	.transform((value) => value?.trim() || null)
	.pipe(volunteerMobileSchema.nullable());
