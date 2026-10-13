/**
 * Client-side pre-check for the family search box. Mirrors the backend classifier
 * (backend/apiapp/utils/search_query.py) so a query the backend accepts is never blocked
 * here — we only intercept queries the API would reject with 422 anyway.
 *
 * Whitespace deliberately follows Python (`str.strip()` / `re` `\s`), not JS: Python does not
 * treat U+FEFF as whitespace but does treat U+001C-U+001F and U+0085 as whitespace.
 */

export type FamilySearchInputIssue = 'tooShort' | 'incompletePhone' | 'tooLong';

/** Mirrors `SearchRequest.search` `max_length` (backend/apiapp/modules/evacuee/schemas.py). */
export const FAMILY_SEARCH_MAX_LENGTH = 200;

/** Python `str.isspace()` / `re` `\s` code points (verified against CPython). */
const PY_WS =
	'\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_TRIM = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'gu');
const SEPARATORS = new RegExp(`[${PY_WS}-]+`, 'gu');
const PHONE_SEPARATORS = new RegExp(`[${PY_WS}\\-()]+`, 'gu');
const DIGITS_ONLY = /^\p{Nd}+$/u;
const THAI_PHONE = /^0\p{Nd}{8,9}$/u;
const NATIONAL_ID_LENGTH = 13;

/** Trim exactly like the backend's `str.strip()`; send this, not `String.prototype.trim()`. */
export function normalizeFamilySearchQuery(query: string): string {
	return query.replace(PY_TRIM, '');
}

function normalizePhone(value: string): string | null {
	let digits = value.replace(PHONE_SEPARATORS, '');
	if (digits.startsWith('+66')) digits = `0${digits.slice(3)}`;
	return THAI_PHONE.test(digits) ? digits : null;
}

/**
 * Returns `null` when the query can be sent, or the reason it should not be.
 *
 * - Digits only (separators ignored): valid as a 13-digit national ID or a Thai phone
 *   (a missing leading 0 is tolerated, as in the backend); anything else is `incompletePhone`.
 * - Passport / formatted phone (`+66…`, `(081) …`) / free text follow the backend rules;
 *   free text shorter than 3 characters is `tooShort`.
 */
export function validateFamilySearchQuery(query: string): FamilySearchInputIssue | null {
	const raw = normalizeFamilySearchQuery(query);
	if (!raw) return 'tooShort';
	if ([...raw].length > FAMILY_SEARCH_MAX_LENGTH) return 'tooLong';

	const compact = raw.replace(SEPARATORS, '');

	if (DIGITS_ONLY.test(compact)) {
		if ([...compact].length === NATIONAL_ID_LENGTH) return null;
		return normalizePhone(compact.startsWith('0') ? compact : `0${compact}`)
			? null
			: 'incompletePhone';
	}

	if (/^[A-Za-z]{1,2}\d{6,9}$/.test(compact)) return null;
	if (normalizePhone(compact)) return null;

	return [...raw].length < 3 ? 'tooShort' : null;
}
