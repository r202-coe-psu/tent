/**
 * Client-side pre-check for the family search box. Mirrors the backend classifier
 * (backend/apiapp/utils/search_query.py) so a query the backend accepts is never blocked
 * here — we only intercept queries the API would reject with 422 anyway.
 *
 * Whitespace deliberately follows Python (`str.strip()` / `re` `\s`), not JS: Python does not
 * treat U+FEFF as whitespace but does treat U+001C-U+001F and U+0085 as whitespace.
 */

export type FamilySearchInputIssue = 'tooShort' | 'incompletePhone' | 'tooLong' | 'tooManyWords';

/** Mirrors `SearchRequest.search` `max_length` (backend/apiapp/modules/evacuee/schemas.py). */
export const FAMILY_SEARCH_MAX_LENGTH = 200;

/** Python `str.isspace()` / `re` `\s` code points (verified against CPython). */
const PY_WS =
	'\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
const PY_TRIM = new RegExp(`^[${PY_WS}]+|[${PY_WS}]+$`, 'gu');
const SEPARATORS = new RegExp(`[${PY_WS}-]+`, 'gu');
const PHONE_SEPARATORS = new RegExp(`[${PY_WS}\\-()]+`, 'gu');
const DIGITS_ONLY = /^\p{Nd}+$/u;
const THAI_PHONE = /^0\p{Nd}{9}$/u;
const NATIONAL_ID_LENGTH = 13;

/** Mirror `MIN_NAME_WORD_GRAPHEMES` / `MAX_NAME_WORDS` in backend/apiapp/utils/search_query.py (CR-166). */
export const NAME_WORD_MIN_GRAPHEMES = 2;
export const NAME_MAX_WORDS = 4;

const PY_WS_RUN = new RegExp(`[${PY_WS}]+`, 'gu');
const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function graphemeCount(word: string): number {
	return [...graphemes.segment(word)].length;
}

/**
 * The backend's `name_key`: NFKC, case fold, one space between words. The backend counts
 * graphemes (not code points — Thai "มี" is one), so this does too. `toLowerCase` stands in
 * for Python `casefold`, so "ß" is expanded by hand. It can still differ from the backend
 * for rare scripts (e.g. a Devanagari conjunct is 2 graphemes to Python, 1 to `Intl.Segmenter`);
 * the backend (422) remains the authority for those.
 */
function nameWords(query: string): string[] {
	return query
		.normalize('NFKC')
		.toLowerCase()
		.replace(/ß|ẞ/gu, 'ss')
		.replace(PY_WS_RUN, ' ')
		.replace(PY_TRIM, '')
		.split(' ');
}

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
 *   a name is split into words and every word needs >= 2 graphemes (`tooShort`), at most
 *   4 words (`tooManyWords`) — CR-166.
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

	const words = nameWords(raw);
	if (words.some((word) => graphemeCount(word) < NAME_WORD_MIN_GRAPHEMES)) return 'tooShort';
	return words.length > NAME_MAX_WORDS ? 'tooManyWords' : null;
}
