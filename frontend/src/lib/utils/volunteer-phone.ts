import { z } from 'zod';
import { normalizeThaiPhone } from '$lib/db/model';

/*
 * Volunteer mobile rule (#951). The one normaliser is `normalizeThaiPhone` in `$lib/db/model`
 * (CR-206 / #994 review), so the same number hashes to the same `phone_hash` in every feature.
 * These exports become re-exports of `thaiMobilePhoneSchema` from `$lib/db/model` once #981 merges.
 */

export const VOLUNTEER_PHONE_MESSAGE = 'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0';

/** True when `value` normalises to a 10-digit mobile (`^0\d{9}$`). */
export function isVolunteerMobile(value: string | null | undefined): boolean {
	return /^0\d{9}$/.test(normalizeThaiPhone(value ?? ''));
}

/** The single volunteer phone rule (#951): outputs the normalised 10-digit mobile. */
export const volunteerMobileSchema = z
	.string()
	.transform((value) => normalizeThaiPhone(value))
	.pipe(z.string().regex(/^0\d{9}$/, VOLUNTEER_PHONE_MESSAGE));

/** Same rule, but blank/null/undefined is allowed and becomes `null`. */
export const optionalVolunteerMobileSchema = z
	.string()
	.nullish()
	.transform((value) => value?.trim() || null)
	.pipe(volunteerMobileSchema.nullable());
