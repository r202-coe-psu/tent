/**
 * shift-draft.ts — the editable shift-card list (#624).
 *
 * Pure TypeScript — no I/O, no Svelte. Backs the card list shared by the job
 * create/edit form and the job detail "Shifts Generator": every sub-shift is a
 * card edited in place, "+ เพิ่มกะ" appends one, and each card shows its own
 * error. The persisted shape is still `JobShift` (CR-102 / CR-107) — a card is
 * just a `JobShift` whose `date` may be empty until the user picks one.
 *
 * Per-card rules reuse `validateShiftEdit`, so a card and the standalone
 * single-shift dialog can never disagree.
 */

import type { JobShift } from './job.schema';
import { defaultShiftEndDate } from './shift-batch';
import { validateShiftEdit } from './shift-edit';

/** Times and headcount a brand-new list starts with. */
export const DEFAULT_SHIFT_TIMES = { start_time: '08:00', end_time: '16:00', quota: 5 } as const;

/**
 * A new, still-undated card. It copies the times and headcount of the card
 * before it, since consecutive shifts of one job usually share them.
 */
export function newShiftCard(previous: JobShift | undefined, id: string): JobShift {
	const source = previous ?? DEFAULT_SHIFT_TIMES;
	return {
		id,
		date: '',
		end_date: '',
		start_time: source.start_time,
		end_time: source.end_time,
		quota: source.quota
	};
}

/**
 * Apply an edit to one card. `end_date` is re-derived (next day when the
 * shift crosses midnight) only when the date or a time changed — a stored
 * shift whose end date was set by hand (longer than 24h) keeps it while only
 * its headcount is edited.
 */
export function updateShiftCard(
	card: JobShift,
	patch: Partial<Pick<JobShift, 'date' | 'start_time' | 'end_time' | 'quota'>>
): JobShift {
	const next = { ...card, ...patch };
	const timingChanged =
		next.date !== card.date ||
		next.start_time !== card.start_time ||
		next.end_time !== card.end_time;
	if (!timingChanged) return next;
	if (!next.date) return { ...next, end_date: '' };
	try {
		return { ...next, end_date: defaultShiftEndDate(next.date, next.start_time, next.end_time) };
	} catch {
		// Unparseable date — leave end_date for validation to report.
		return { ...next, end_date: next.date };
	}
}

/**
 * Thai error per card id (`null` = valid). Duplicates are checked against the
 * other cards and against `existing` — shifts already saved on the job when
 * the cards are new additions (the detail page generator).
 *
 * @param minQuotaById seats a saved shift already holds; cutting below is an error.
 */
export function shiftCardErrors(
	cards: readonly JobShift[],
	options: {
		existing?: readonly JobShift[];
		minQuotaById?: Readonly<Record<string, number>>;
	} = {}
): Record<string, string | null> {
	const existing = options.existing ?? [];
	const errors: Record<string, string | null> = {};
	for (const card of cards) {
		const siblings = [...cards.filter((c) => c.id !== card.id), ...existing];
		errors[card.id] = validateShiftEdit(
			{ date: card.date, start_time: card.start_time, end_time: card.end_time, quota: card.quota },
			siblings,
			options.minQuotaById?.[card.id] ?? 0
		).error;
	}
	return errors;
}

/** "กะที่ N: <reason>" for the first broken card, or `null` when every card is valid. */
export function firstShiftCardError(
	cards: readonly JobShift[],
	errors: Readonly<Record<string, string | null>>
): string | null {
	const index = cards.findIndex((c) => errors[c.id]);
	return index === -1 ? null : `กะที่ ${index + 1}: ${errors[cards[index].id]}`;
}
