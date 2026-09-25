import type { DonationSlot, DonationSlotMode, DonationStatus } from '$lib/features/operations';
import { countSlotBookings, slotsOnDate } from '$lib/features/operations';

/**
 * Drop-off / pickup queue availability (schema.md §2.13, DN-5).
 *
 * The two queues are computed the same way but constrain different things: a
 * drop-off window has no ceiling unless staff set one (the counter takes whoever
 * turns up), while a pickup window is capped by the vehicles the shelter has.
 *
 * Shared by:
 * - `GET  /api/public/v1/donations/slots` (the wizard's step-3 grid)
 * - `POST /api/public/v1/donations`       (the SLOT_FULL re-check at submit)
 *
 * Both have to agree on what "full" means, or the grid offers a window the submit
 * then rejects.
 */

export type SlotStatus = 'available' | 'full' | 'closed';

export interface SlotAvailability {
	/** `"09:00 - 10:00"` — the label the booking is submitted with. */
	label: string;
	from: string;
	to: string;
	/** `null` = the shelter has not configured this window, so it has no ceiling. */
	capacity: number | null;
	booked: number;
	status: SlotStatus;
}

/**
 * Windows offered when a shelter has configured no `donation_slot` for the date.
 *
 * Unconfigured means "no ceiling", not "closed": `POST /api/public/v1/donations`
 * lets a booking through when the slot doc is missing, so hiding the grid here
 * would refuse bookings the write path accepts. They are the standard opening hours
 * a donor may drive up in — a shelter that wants its VEHICLE queue used has to
 * publish those windows itself, which is why a pickup date with nothing configured
 * comes back empty rather than falling back to these.
 */
export const DEFAULT_SLOT_WINDOWS: readonly { from: string; to: string }[] = [
	{ from: '09:00', to: '10:00' },
	{ from: '10:00', to: '11:00' },
	{ from: '13:00', to: '14:00' },
	{ from: '14:00', to: '15:00' },
	{ from: '15:00', to: '16:00' }
];

export function slotLabel(from: string, to: string): string {
	return `${from} - ${to}`;
}

/**
 * The only part of a donation a slot count looks at.
 *
 * Structural rather than `Pick<PublicDonationDoc, …>` so both callers fit: the BFF
 * holds public donation docs, the back-office board holds `Donation` (whose
 * `logistics.slot` is nullable).
 */
export interface SlotBooking {
	status: DonationStatus;
	logistics?: { slot?: { date: string; from: string; to: string } | null } | null;
}

/**
 * How many bookings already hold a place in one window. The rule lives with the slot
 * (`countSlotBookings` in operations) so the back-office delete guard reads the same one.
 */
export function slotBookedCount(
	donations: readonly SlotBooking[],
	date: string,
	from: string
): number {
	return countSlotBookings(donations, date, from);
}

/** Availability of one configured window. A `null` capacity never reads as full. */
export function slotAvailabilityFor(
	slot: DonationSlot,
	donations: readonly SlotBooking[]
): SlotAvailability {
	const booked = slotBookedCount(donations, slot.date, slot.from);
	const capacity = slot.capacity ?? null;
	const status: SlotStatus =
		slot.status === 'closed'
			? 'closed'
			: capacity !== null && booked >= capacity
				? 'full'
				: 'available';
	return {
		label: slotLabel(slot.from, slot.to),
		from: slot.from,
		to: slot.to,
		capacity,
		booked,
		status
	};
}

/**
 * The whole grid for one queue on one date.
 *
 * The two queues answer differently when the shelter has published nothing:
 *
 * · **dropoff** — the standard opening hours are always on the board. Nobody has to
 *   queue for a counter, so a shelter that publishes a window is narrowing or
 *   capping ONE hour, not declaring the rest of the day shut. Its window overrides
 *   the standard one at that start time and any extra hour is added.
 * · **pickup** — only what the shelter published. No vehicle schedule means no
 *   vehicle, and falling back would promise a truck that does not exist.
 */
export function computeSlotAvailability(
	date: string,
	mode: DonationSlotMode,
	slots: readonly DonationSlot[],
	donations: readonly SlotBooking[]
): SlotAvailability[] {
	// One window per start time. A slot written before the two queues were split
	// carries no `mode` and reads as drop-off, so it can collide with the explicit
	// window staff later created for the same hour — two entries whose label is
	// identical, which is both meaningless to a donor and a duplicate `{#each}` key.
	// The explicit one wins; the legacy doc is what staff are replacing.
	const byStart = new Map<string, DonationSlot>();
	for (const slot of slotsOnDate(
		slots.filter((s) => s?.type === 'donation_slot'),
		mode,
		date
	)) {
		const held = byStart.get(slot.from);
		if (!held || (held.mode === undefined && slot.mode !== undefined)) {
			byStart.set(slot.from, slot);
		}
	}

	if (mode === 'pickup') {
		return [...byStart.values()].map((slot) => slotAvailabilityFor(slot, donations));
	}

	const board: SlotAvailability[] = DEFAULT_SLOT_WINDOWS.filter(
		(window) => !byStart.has(window.from)
	).map((window) => ({
		label: slotLabel(window.from, window.to),
		from: window.from,
		to: window.to,
		capacity: null,
		booked: slotBookedCount(donations, date, window.from),
		status: 'available' as const
	}));

	for (const slot of byStart.values()) {
		board.push(slotAvailabilityFor(slot, donations));
	}

	return board.sort((a, b) => a.from.localeCompare(b.from));
}

/** The queue a delivery method books into — `parcel` books none. */
export function slotModeForDelivery(
	method: 'self_dropoff' | 'parcel' | 'shelter_pickup'
): DonationSlotMode | null {
	if (method === 'self_dropoff') return 'dropoff';
	if (method === 'shelter_pickup') return 'pickup';
	return null;
}
