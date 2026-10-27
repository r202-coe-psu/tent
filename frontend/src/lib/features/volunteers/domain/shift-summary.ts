/**
 * shift-summary.ts — collapse a public job card's long shift list.
 *
 * Pure — no I/O, no Svelte. A job batch-generated over weeks lists dozens of shifts,
 * each a full block with its own quota bar and apply button, so one card ran several
 * screens long. The card shows its first few shifts in full and summarises the rest —
 * which dates and which times — so nobody has to expand it to know what is there.
 */

export interface SummarisableShift {
	id: string;
	/** `YYYY-MM-DD`. */
	date: string;
	/** Display time, e.g. `08:00 - 12:00 น.`. */
	time: string;
	quota: number;
	confirmed: number;
}

export interface HiddenShiftSummary {
	count: number;
	/** Each hidden date once, in order; `open` = at least one of its shifts has a seat. */
	dates: { date: string; open: boolean }[];
	/** Each distinct time range once, in order. */
	times: string[];
}

/** Shifts in date, then time, order. */
export function sortShifts<T extends SummarisableShift>(shifts: readonly T[]): T[] {
	return [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time));
}

/** `08:00 - 12:00 น.` → `08:00–12:00`; anything else is returned trimmed. */
export function compactTimeRange(time: string): string {
	const match = time.match(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/);
	return match ? `${match[1]}–${match[2]}` : time.trim();
}

/** What the shifts after the first `shown` contain — empty when nothing is hidden. */
export function summariseHiddenShifts<T extends SummarisableShift>(
	sorted: readonly T[],
	shown: number
): HiddenShiftSummary {
	const hidden = sorted.slice(shown);
	const dates = new Map<string, boolean>();
	const times = new Set<string>();
	for (const shift of hidden) {
		const open = shift.quota - shift.confirmed > 0;
		dates.set(shift.date, (dates.get(shift.date) ?? false) || open);
		times.add(compactTimeRange(shift.time));
	}
	return {
		count: hidden.length,
		dates: [...dates].map(([date, open]) => ({ date, open })),
		times: [...times].sort()
	};
}
