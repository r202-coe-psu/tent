/**
 * shift-picker.ts — group a job's shifts for the public quick-apply shift picker.
 *
 * Pure — no I/O, no Svelte. The picker is an agenda: one row per date with that date's
 * times beside it, instead of a card per shift — a job batch-generated over a month has
 * dozens of shifts, and a card each made the apply form several screens tall. Every date
 * stays visible (no sideways scrolling that hides dates off-screen); a long job shows its
 * first week and says how many more dates there are.
 */

export interface PickableShift {
	id: string;
	/** `YYYY-MM-DD`. */
	date: string;
	start_time?: string;
	quota: number;
	confirmed: number;
}

export interface ShiftDateGroup<T extends PickableShift> {
	date: string;
	/** The date's shifts, earliest first. */
	shifts: T[];
	/** Whether any shift on the date still has a seat. */
	hasSeat: boolean;
}

/** Seats still open in a shift (never negative). */
export function seatsLeft(shift: PickableShift): number {
	return Math.max(0, shift.quota - shift.confirmed);
}

/** Shifts grouped by date, dates and times in order. */
export function groupShiftsByDate<T extends PickableShift>(
	shifts: readonly T[]
): ShiftDateGroup<T>[] {
	const byDate = new Map<string, T[]>();
	for (const shift of shifts) {
		const list = byDate.get(shift.date);
		if (list) list.push(shift);
		else byDate.set(shift.date, [shift]);
	}
	return [...byDate.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([date, list]) => {
			const sorted = [...list].sort((a, b) =>
				(a.start_time ?? '').localeCompare(b.start_time ?? '')
			);
			return { date, shifts: sorted, hasSeat: sorted.some((s) => seatsLeft(s) > 0) };
		});
}

/** Dates shown before "แสดงวันที่เหลืออีก N วัน". */
export const PICKER_INITIAL_DATES = 7;

/**
 * How many date rows to show: the first {@link PICKER_INITIAL_DATES}, or more when the
 * already-selected shift (picked on the job card) falls later — it must never be hidden.
 */
export function visibleDateCount<T extends PickableShift>(
	groups: readonly ShiftDateGroup<T>[],
	selectedDate: string | undefined,
	minimum: number = PICKER_INITIAL_DATES
): number {
	const selectedIndex = selectedDate ? groups.findIndex((g) => g.date === selectedDate) : -1;
	return Math.min(groups.length, Math.max(minimum, selectedIndex + 1));
}

/**
 * Format a shift's `YYYY-MM-DD` date for display, at UTC so no offset can shift the day.
 * Anything that is not a valid `YYYY-MM-DD` (legacy `dd/mm/yyyy` data, a typo) is shown
 * as it came — `Intl` would otherwise throw a `RangeError` and take the whole card or
 * form down with it.
 */
export function formatShiftDate(
	date: string,
	locale: string,
	options: Intl.DateTimeFormatOptions
): string {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
	const parsed = new Date(`${date}T00:00:00Z`);
	if (Number.isNaN(parsed.getTime())) return date;
	return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(parsed);
}
