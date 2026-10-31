import { z } from 'zod';
import {
	isThaiMobilePhone,
	THAI_MOBILE_PHONE_MESSAGE,
	requiredThaiMobilePhoneSchema
} from '$lib/db/model';

/*
 * Volunteer mobile rule (#951). The system-wide rule (CR-210 / #991) lives in `$lib/db/model`
 * (`normalizeThaiPhone`, `requiredThaiMobilePhoneSchema`); these are volunteer-named aliases so the same
 * number hashes to the same `phone_hash` in every feature.
 */

export const VOLUNTEER_PHONE_MESSAGE = THAI_MOBILE_PHONE_MESSAGE;

/** True when `value` normalises to a 10-digit mobile (`^0\d{9}$`). */
export const isVolunteerMobile = isThaiMobilePhone;

/** The single volunteer phone rule (#951): outputs the normalised 10-digit mobile. */
export const volunteerMobileSchema = requiredThaiMobilePhoneSchema;

/** Same rule, but blank/null/undefined is allowed and becomes `null`. */
export const optionalVolunteerMobileSchema = z
	.string()
	.nullish()
	.transform((value) => value?.trim() || null)
	.pipe(volunteerMobileSchema.nullable());
