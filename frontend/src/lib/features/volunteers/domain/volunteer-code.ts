/**
 * volunteer-code.ts — human-readable volunteer codes (CR-094 §3.1 `volunteer_code`).
 *
 * `V-{NNN}`, counted per shelter, zero-padded to 3 digits (widens past 999
 * instead of truncating). Codes are minted from the shelter's *existing* code
 * list — callers fetch that list from the data layer; this module never touches I/O.
 *
 * NOTE (F14, known spec gap — not solved here): `volunteer_code` has no
 * unique index in schema.md §2.8. Two concurrent walk-in registrations can
 * both read the same "existing codes" snapshot and mint the same next code —
 * that race is out of scope for this pure function (it would need a
 * CouchDB-side uniqueness constraint or a retry-on-conflict loop in the data
 * layer) and is left as a known gap.
 */

const VOLUNTEER_CODE_RE = /^V-(\d+)$/i;

/** Zero-pad to 3 digits; wider once `n >= 1000` (`V-1000`, not truncated). */
export function formatVolunteerCode(n: number): string {
	return `V-${String(n).padStart(3, '0')}`;
}

/**
 * Next sequential code after the highest `V-{NNN}` in `existingCodes`
 * (non-matching entries ignored). Case-insensitive — `v-001`/`V-001` count as
 * the same code, so a lowercased entry never causes a duplicate mint.
 */
export function nextVolunteerCode(existingCodes: readonly string[]): string {
	const max = existingCodes.reduce((acc, code) => {
		const match = VOLUNTEER_CODE_RE.exec(code.trim());
		if (!match) return acc;
		return Math.max(acc, Number(match[1]));
	}, 0);
	return formatVolunteerCode(max + 1);
}
