/**
 * Date-time cells of the Backfill Import (#1399): Thai wall-clock text → UTC ISO.
 *
 * The file speaks `วว/ดด/ปปปป ชช:นน`, Buddhist-era year, Asia/Bangkok time. Thailand has no DST,
 * so the zone is a fixed UTC+7 and the conversion needs no tz database. Pure / isomorphic.
 */

const BANGKOK_OFFSET_HOURS = 7;
/** Years above this are Buddhist-era; a Gregorian year typed by habit (e.g. 2026) is also accepted. */
const BE_THRESHOLD = 2400;
const BE_OFFSET = 543;

const PATTERN = /^(\d{1,2})\/(\d{1,2})\/(\d{4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?$/;

/** Parse one cell. `null` = not a valid Thai date-time (wrong shape or a day that does not exist). */
export function parseImportDateTime(text: string): Date | null {
	const m = PATTERN.exec(text.trim());
	if (!m) return null;
	const [day, month, rawYear, hour, minute, second] = [
		Number(m[1]),
		Number(m[2]),
		Number(m[3]),
		Number(m[4]),
		Number(m[5]),
		Number(m[6] ?? 0)
	];
	const year = rawYear >= BE_THRESHOLD ? rawYear - BE_OFFSET : rawYear;
	const date = new Date(
		Date.UTC(year, month - 1, day, hour - BANGKOK_OFFSET_HOURS, minute, second)
	);
	// Round-trip through Bangkok wall-clock: rejects 31/02, 25:00, month 13 … which Date.UTC rolls over.
	const wall = new Date(date.getTime() + BANGKOK_OFFSET_HOURS * 3_600_000);
	if (
		wall.getUTCFullYear() !== year ||
		wall.getUTCMonth() !== month - 1 ||
		wall.getUTCDate() !== day ||
		wall.getUTCHours() !== hour ||
		wall.getUTCMinutes() !== minute ||
		wall.getUTCSeconds() !== second
	) {
		return null;
	}
	return date;
}

function pad(n: number): string {
	return String(n).padStart(2, '0');
}

/**
 * Format a spreadsheet date cell back into the file's own text format.
 *
 * Excel stores a typed wall-clock as a serial with no zone, which exceljs surfaces as a `Date`
 * whose **UTC** fields equal what the user typed — so the UTC getters are the wall-clock here.
 */
export function formatWallClock(date: Date): string {
	return (
		`${pad(date.getUTCDate())}/${pad(date.getUTCMonth() + 1)}/${date.getUTCFullYear() + BE_OFFSET} ` +
		`${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
	);
}

/** An instant → the file's text format, in Bangkok time (for the template's sample row). */
export function formatThaiDateTime(date: Date): string {
	return formatWallClock(new Date(date.getTime() + BANGKOK_OFFSET_HOURS * 3_600_000));
}
