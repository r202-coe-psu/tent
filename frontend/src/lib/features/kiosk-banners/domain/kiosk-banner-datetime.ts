/** Asia/Bangkok is a fixed UTC+07:00 (no DST), so the form can convert with plain arithmetic. */
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;

const LOCAL_INPUT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** UTC ISO instant -> `YYYY-MM-DDTHH:mm` wall-clock in Asia/Bangkok (for `datetime-local`). */
export function toBangkokLocalInput(iso: string): string {
	return new Date(Date.parse(iso) + BANGKOK_OFFSET_MS).toISOString().slice(0, 16);
}

/** `datetime-local` value read as Asia/Bangkok -> UTC ISO string; `null` when empty or invalid. */
export function fromBangkokLocalInput(local: string): string | null {
	const match = LOCAL_INPUT.exec(local);
	if (!match) return null;
	const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part ?? 0));
	const utc = Date.UTC(year, month - 1, day, hour, minute, second);
	const date = new Date(utc);
	// Reject rollovers such as month 13 or day 40.
	if (
		date.getUTCFullYear() !== year ||
		date.getUTCMonth() !== month - 1 ||
		date.getUTCDate() !== day ||
		hour > 23 ||
		minute > 59 ||
		second > 59
	) {
		return null;
	}
	return new Date(utc - BANGKOK_OFFSET_MS).toISOString();
}

/** `datetime-local` value -> the separate date (`YYYY-MM-DD`) and time (`HH:mm`) picker values. */
export function splitLocalInput(local: string): { date: string; time: string } {
	const [date = '', time = ''] = local.split('T');
	return { date, time };
}

/**
 * Date + time picker values -> one `datetime-local` value. A half-filled pair is kept as is (it
 * splits back unchanged) and fails {@link fromBangkokLocalInput} until both are chosen.
 */
export function joinLocalInput(date: string, time: string): string {
	return date || time ? `${date}T${time}` : '';
}
