import { z } from 'zod';
import { makeDoc, touch, type AuthorContext } from '$lib/db/model';
import type { DonationSlot, DonationSlotMode } from './operations';

/**
 * `donation_slot` (schema.md §2.13, DN-5) — the windows a shelter opens for public
 * donations, kept as two separate queues:
 *
 * · `dropoff` — the donor brings the goods. The counter takes whoever turns up, so a
 *   window here is opening hours: `capacity` is normally `null` (no ceiling).
 * · `pickup`  — the shelter's own vehicle goes out. That fleet is finite, so these
 *   windows carry a real `capacity` and are what `SLOT_FULL` protects.
 *
 * `_id` is deterministic per mode + date + start time so two staff devices creating
 * the same window end up editing one doc instead of minting two that each carry
 * their own capacity.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export const donationSlotInputSchema = z
	.object({
		mode: z.enum(['dropoff', 'pickup']),
		date: z.string().regex(YMD, 'รูปแบบวันที่ต้องเป็น YYYY-MM-DD'),
		from: z.string().regex(HHMM, 'เวลาเริ่มต้องเป็นรูปแบบ HH:mm'),
		to: z.string().regex(HHMM, 'เวลาสิ้นสุดต้องเป็นรูปแบบ HH:mm'),
		capacity: z.coerce.number().int().positive('ความจุต้องมากกว่า 0').nullable().default(null),
		status: z.enum(['open', 'closed']).optional().default('open'),
		note: z.string().trim().optional()
	})
	// String compare is enough on zero-padded HH:mm, and it keeps the rule where the
	// shape is defined rather than in each caller.
	.refine((s) => s.to > s.from, {
		message: 'เวลาสิ้นสุดต้องหลังเวลาเริ่ม',
		path: ['to']
	})
	// An uncapped pickup window would promise every donor a vehicle the shelter does
	// not have — the whole reason the two queues are separate.
	.refine((s) => s.mode !== 'pickup' || s.capacity !== null, {
		message: 'คิวรถไปรับต้องกำหนดจำนวนเที่ยว',
		path: ['capacity']
	});

export type DonationSlotInput = z.input<typeof donationSlotInputSchema>;

/**
 * Capacity as a form field hands it over: blank or cleared means no ceiling.
 *
 * `bind:value` on `<input type="number">` yields a **number** once anything is typed
 * and `null` when the field is emptied, while the initial state and a change event
 * carry a string — so this has to take all three rather than assume one.
 * Unparseable text comes back as `NaN`, which the schema then rejects with the same
 * message a bad number would get.
 */
export function parseCapacityInput(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
	const trimmed = String(raw).trim();
	if (trimmed === '') return null;
	return Number(trimmed);
}

export function donationSlotId(mode: DonationSlotMode, date: string, from: string): string {
	return `donation_slot:${mode}:${date}:${from}`;
}

export function createDonationSlot(input: DonationSlotInput, ctx: AuthorContext): DonationSlot {
	const d = donationSlotInputSchema.parse(input);
	return makeDoc(
		'donation_slot',
		1,
		{
			mode: d.mode,
			date: d.date,
			from: d.from,
			to: d.to,
			capacity: d.capacity,
			status: d.status,
			...(d.note ? { note: d.note } : {})
		},
		ctx,
		`${d.mode}:${d.date}:${d.from}`
	);
}

/**
 * Apply an edit to an existing window.
 *
 * `mode`/`date`/`from` are the identity, so they are taken from the doc, not the
 * form — moving a window to another time means creating one and closing this.
 */
export function editDonationSlot(
	slot: DonationSlot,
	patch: {
		to?: string;
		capacity?: number | null;
		status?: 'open' | 'closed';
		note?: string;
	}
): DonationSlot {
	const merged = donationSlotInputSchema.parse({
		mode: slot.mode,
		date: slot.date,
		from: slot.from,
		to: patch.to ?? slot.to,
		capacity: patch.capacity !== undefined ? patch.capacity : slot.capacity,
		status: patch.status ?? slot.status,
		note: patch.note ?? slot.note
	});

	return touch({
		...slot,
		to: merged.to,
		capacity: merged.capacity,
		status: merged.status,
		...(merged.note ? { note: merged.note } : {})
	});
}

/** Windows of one queue on one date, earliest first. */
export function slotsOnDate(
	slots: readonly DonationSlot[],
	mode: DonationSlotMode,
	date: string
): DonationSlot[] {
	return slots
		.filter((s) => s.date === date && slotMode(s) === mode)
		.sort((a, b) => a.from.localeCompare(b.from));
}

/**
 * A slot's queue, defaulting to `dropoff`.
 *
 * Windows written before the two queues were split carry no `mode`, and the drop-off
 * counter is what they meant — reading them as pickup would cap a queue the shelter
 * never meant to cap.
 */
export function slotMode(slot: Pick<DonationSlot, 'mode'>): DonationSlotMode {
	return slot.mode === 'pickup' ? 'pickup' : 'dropoff';
}

/** Dates that have at least one window in this queue, earliest first. */
export function slotDates(slots: readonly DonationSlot[], mode: DonationSlotMode): string[] {
	return [...new Set(slots.filter((s) => slotMode(s) === mode).map((s) => s.date))].sort();
}
