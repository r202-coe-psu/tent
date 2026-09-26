import { describe, it, expect } from 'vitest';
import type { DonationSlot } from '$lib/features/operations';
import {
	DEFAULT_SLOT_WINDOWS,
	computeSlotAvailability,
	slotAvailabilityFor,
	slotBookedCount,
	slotModeForDelivery
} from './compute-slots';
import type { PublicDonationDoc } from './public-donation';

const DATE = '2026-09-22';

function slot(over: Partial<DonationSlot> = {}): DonationSlot {
	return {
		_id: `donation_slot:${over.mode ?? 'pickup'}:${DATE}:${over.from ?? '09:00'}`,
		type: 'donation_slot',
		mode: 'pickup',
		date: DATE,
		from: '09:00',
		to: '10:00',
		capacity: 2,
		status: 'open',
		...over
	} as DonationSlot;
}

function booking(status: string, from = '09:00', date = DATE) {
	return {
		status,
		logistics: { delivery_method: 'self_dropoff', slot: { date, from, to: '10:00' } }
	} as unknown as PublicDonationDoc;
}

describe('slotBookedCount', () => {
	it('counts outstanding and received bookings in the same window', () => {
		const donations = [
			booking('declared'),
			booking('pending_review'),
			booking('verifying'),
			booking('received')
		];
		expect(slotBookedCount(donations, DATE, '09:00')).toBe(4);
	});

	it('ignores bookings that released the place, other windows and other dates', () => {
		const donations = [
			booking('cancelled'),
			booking('rejected'),
			booking('expired'),
			booking('declared', '13:00'),
			booking('declared', '09:00', '2026-09-23')
		];
		expect(slotBookedCount(donations, DATE, '09:00')).toBe(0);
	});
});

describe('slotAvailabilityFor', () => {
	it('is available while bookings are under capacity', () => {
		const result = slotAvailabilityFor(slot({ capacity: 2 }), [booking('declared')]);
		expect(result).toMatchObject({ label: '09:00 - 10:00', booked: 1, status: 'available' });
	});

	it('turns full once bookings reach capacity', () => {
		const result = slotAvailabilityFor(slot({ capacity: 2 }), [
			booking('declared'),
			booking('received')
		]);
		expect(result.status).toBe('full');
	});

	it('reports a closed window as closed even with room left', () => {
		expect(slotAvailabilityFor(slot({ status: 'closed' }), []).status).toBe('closed');
	});

	it('never reads an uncapped window as full', () => {
		const result = slotAvailabilityFor(slot({ mode: 'dropoff', capacity: null }), [
			booking('declared'),
			booking('declared'),
			booking('received')
		]);
		expect(result).toMatchObject({ capacity: null, booked: 3, status: 'available' });
	});
});

describe('slotModeForDelivery', () => {
	it('maps each delivery method to the queue it books into', () => {
		expect(slotModeForDelivery('self_dropoff')).toBe('dropoff');
		expect(slotModeForDelivery('shelter_pickup')).toBe('pickup');
		// A parcel meets nobody, so it holds no place in either queue.
		expect(slotModeForDelivery('parcel')).toBeNull();
	});
});

describe('computeSlotAvailability', () => {
	it('uses the shelter-configured pickup runs for that date, sorted by start time', () => {
		const slots = [
			slot({ from: '13:00', to: '14:00', capacity: 1 }),
			slot({ from: '09:00', to: '10:00', capacity: 1 })
		];
		const result = computeSlotAvailability(DATE, 'pickup', slots, [booking('declared', '13:00')]);

		expect(result.map((s) => s.label)).toEqual(['09:00 - 10:00', '13:00 - 14:00']);
		expect(result.map((s) => s.status)).toEqual(['available', 'full']);
	});

	it('keeps the rest of the drop-off day open when the shelter configures one hour', () => {
		// Publishing 09:00 narrows that hour; it does not shut the counter for the day.
		const result = computeSlotAvailability(
			DATE,
			'dropoff',
			[slot({ from: '09:00', to: '10:00', mode: 'dropoff', status: 'closed', capacity: null })],
			[]
		);

		expect(result).toHaveLength(DEFAULT_SLOT_WINDOWS.length);
		expect(result[0]).toMatchObject({ from: '09:00', status: 'closed' });
		expect(result.slice(1).every((s) => s.status === 'available')).toBe(true);
	});

	it('adds a drop-off hour outside the standard windows', () => {
		const result = computeSlotAvailability(
			DATE,
			'dropoff',
			[slot({ from: '18:00', to: '19:00', mode: 'dropoff', capacity: 3 })],
			[]
		);

		expect(result).toHaveLength(DEFAULT_SLOT_WINDOWS.length + 1);
		expect(result.at(-1)).toMatchObject({ from: '18:00', capacity: 3 });
	});

	it('falls back to the default windows for drop-off when none is configured', () => {
		// No `donation_slot` doc means no ceiling — POST lets such a booking through,
		// so the grid must offer it instead of showing an empty board.
		const result = computeSlotAvailability(DATE, 'dropoff', [], []);
		expect(result).toHaveLength(DEFAULT_SLOT_WINDOWS.length);
		expect(result.every((s) => s.status === 'available' && s.capacity === null)).toBe(true);
	});

	it('offers no pickup window when the shelter published no vehicle schedule', () => {
		// Falling back here would promise a truck the shelter never offered.
		expect(computeSlotAvailability(DATE, 'pickup', [], [])).toEqual([]);
	});

	it('keeps the two queues apart at the same hour', () => {
		const slots = [
			slot({ from: '09:00', to: '10:00', capacity: 1 }),
			slot({ from: '09:00', to: '10:00', mode: 'dropoff', capacity: null })
		];
		const donations = [booking('declared', '09:00')];

		expect(computeSlotAvailability(DATE, 'pickup', slots, donations)[0].status).toBe('full');
		expect(computeSlotAvailability(DATE, 'dropoff', slots, donations)[0].status).toBe('available');
	});

	it('caps only the drop-off hour the shelter capped', () => {
		const result = computeSlotAvailability(
			DATE,
			'dropoff',
			[slot({ from: '10:00', to: '11:00', mode: 'dropoff', capacity: 1 })],
			[booking('declared', '10:00')]
		);

		expect(result.find((s) => s.from === '10:00')?.status).toBe('full');
		expect(result.find((s) => s.from === '09:00')?.status).toBe('available');
	});

	it('lets an explicitly-moded window replace a legacy one at the same hour', () => {
		// A slot written before the queues were split has no `mode` and reads as
		// drop-off. Staff who then publish the real window would otherwise see both.
		const legacy = { ...slot({ from: '09:00', capacity: 10 }), _id: 'donation_slot:…:09:00' };
		delete (legacy as { mode?: unknown }).mode;
		const explicit = slot({ from: '09:00', mode: 'dropoff', capacity: null });

		const result = computeSlotAvailability(DATE, 'dropoff', [legacy, explicit], []);
		expect(result.filter((s) => s.from === '09:00')).toHaveLength(1);
		expect(result.find((s) => s.from === '09:00')?.capacity).toBeNull();
	});

	it('ignores slots configured for another date', () => {
		const result = computeSlotAvailability(DATE, 'dropoff', [slot({ date: '2026-09-23' })], []);
		expect(result).toHaveLength(DEFAULT_SLOT_WINDOWS.length);
	});
});
