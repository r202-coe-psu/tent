/**
 * When a `lot.expiry` value starts to count as expired (CR-195).
 *
 * Pure: no I/O, no Svelte. A bare date `YYYY-MM-DD` reads "usable through that whole day in
 * Thailand", so it expires at 00:00 Asia/Bangkok of the NEXT day. A datetime expires at its own
 * instant. Every "expired yet?" check and every expiry sort goes through here, never through
 * `Date.parse(lot.expiry)`, which reads a bare date as 00:00 UTC (07:00 in Bangkok).
 */

const MS_DAY = 86_400_000;

/** Asia/Bangkok has no DST, so a fixed offset is exact. */
const BANGKOK_OFFSET = '+07:00';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME =
	/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)(Z|[+-]\d{2}(?::?\d{2})?)?$/i;

/** `YYYY-MM-DD` that exists on the calendar; `Date.parse` alone rolls `2026-02-30` into March. */
export function isRealCalendarDate(value: string): boolean {
	if (!DATE_ONLY.test(value)) return false;
	const parsed = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** `+0700` / `+07` → `+07:00`; `Z` and `+07:00` pass through. */
function normalizeOffset(offset: string): string {
	if (offset.toUpperCase() === 'Z') return 'Z';
	const digits = offset.slice(1).replace(':', '');
	return `${offset[0]}${digits.slice(0, 2)}:${digits.slice(2, 4) || '00'}`;
}

/**
 * Epoch milliseconds at which `expiry` starts to count as expired; `NaN` for empty, malformed,
 * or impossible values (`2026-02-30`).
 *
 * - `YYYY-MM-DD` → 00:00 Asia/Bangkok of the next day.
 * - ISO datetime with `Z` or `±HH:MM` → that instant.
 * - ISO datetime with no offset (legacy rows) → read as Asia/Bangkok.
 */
export function expiryInstant(expiry: string | null | undefined): number {
	const value = expiry?.trim();
	if (!value) return NaN;

	if (isRealCalendarDate(value)) {
		return Date.parse(`${value}T00:00:00${BANGKOK_OFFSET}`) + MS_DAY;
	}

	const m = DATE_TIME.exec(value);
	if (!m || !isRealCalendarDate(m[1])) return NaN;
	const offset = m[3] ? normalizeOffset(m[3]) : BANGKOK_OFFSET;
	return Date.parse(`${m[1]}T${m[2]}${offset}`);
}

/** `now >= expiryInstant(expiry)`; an empty or malformed expiry never counts as passed. */
export function isExpiryPassed(expiry: string | null | undefined, now: number): boolean {
	return now >= expiryInstant(expiry);
}
