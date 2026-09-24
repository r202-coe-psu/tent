import { describe, it, expect } from 'vitest';
import {
	createDonationSlot,
	donationSlotId,
	editDonationSlot,
	parseCapacityInput,
	slotDates,
	slotsOnDate
} from './donation-slot';
import type { DonationSlot } from './operations';

const ctx = { shelterCode: 'SH001', createdBy: 'staff-a' };

function slot(over: Partial<DonationSlot> = {}): DonationSlot {
	return {
		_id: donationSlotId(over.mode ?? 'pickup', over.date ?? '2026-09-22', over.from ?? '09:00'),
		type: 'donation_slot',
		mode: 'pickup',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-22T01:00:00.000Z',
		updated_at: '2026-09-22T01:00:00.000Z',
		created_by: 'staff-a',
		date: '2026-09-22',
		from: '09:00',
		to: '10:00',
		capacity: 5,
		status: 'open',
		...over
	} as DonationSlot;
}

describe('createDonationSlot', () => {
	it('mints the deterministic id so two devices edit one window, not two', () => {
		const a = createDonationSlot(
			{ mode: 'pickup', date: '2026-09-22', from: '09:00', to: '10:00', capacity: 5 },
			ctx
		);
		const b = createDonationSlot(
			{ mode: 'pickup', date: '2026-09-22', from: '09:00', to: '11:00', capacity: 9 },
			ctx
		);

		expect(a._id).toBe('donation_slot:pickup:2026-09-22:09:00');
		expect(b._id).toBe(a._id);
		expect(a).toMatchObject({ type: 'donation_slot', schema_v: 1, shelter_code: 'SH001' });
	});

	it('keeps the two queues in separate docs at the same hour', () => {
		const dropoff = createDonationSlot(
			{ mode: 'dropoff', date: '2026-09-22', from: '09:00', to: '10:00' },
			ctx
		);
		const pickup = createDonationSlot(
			{ mode: 'pickup', date: '2026-09-22', from: '09:00', to: '10:00', capacity: 2 },
			ctx
		);

		expect(dropoff._id).not.toBe(pickup._id);
		// The counter takes whoever turns up; the fleet does not.
		expect(dropoff.capacity).toBeNull();
		expect(pickup.capacity).toBe(2);
	});

	it('refuses a pickup window with no vehicle count', () => {
		expect(() =>
			createDonationSlot({ mode: 'pickup', date: '2026-09-22', from: '09:00', to: '10:00' }, ctx)
		).toThrow();
	});

	it('defaults a new window to open and keeps the note only when given', () => {
		const withNote = createDonationSlot(
			{ mode: 'dropoff', date: '2026-09-22', from: '13:00', to: '14:00', note: ' ประตู 2 ' },
			ctx
		);
		const bare = createDonationSlot(
			{ mode: 'dropoff', date: '2026-09-22', from: '14:00', to: '15:00' },
			ctx
		);

		expect(withNote.status).toBe('open');
		expect(withNote.note).toBe('ประตู 2');
		expect(bare.note).toBeUndefined();
	});

	it.each([
		['เวลาสิ้นสุดก่อนเวลาเริ่ม', { from: '14:00', to: '13:00', capacity: 2 }],
		['ความจุเป็น 0', { from: '09:00', to: '10:00', capacity: 0 }],
		['ความจุติดลบ', { from: '09:00', to: '10:00', capacity: -1 }],
		['เวลาไม่ใช่ HH:mm', { from: '9.00', to: '10:00', capacity: 2 }]
	])('rejects %s', (_label, patch) => {
		expect(() =>
			createDonationSlot({ mode: 'pickup', date: '2026-09-22', ...patch }, ctx)
		).toThrow();
	});
});

describe('editDonationSlot', () => {
	it('keeps identity, applies the patch and bumps updated_at', () => {
		const before = slot();
		const after = editDonationSlot(before, { capacity: 12, status: 'closed' });

		expect(after._id).toBe(before._id);
		expect(after.date).toBe(before.date);
		expect(after.from).toBe(before.from);
		expect(after.capacity).toBe(12);
		expect(after.status).toBe('closed');
		expect(after.updated_at).not.toBe(before.updated_at);
	});

	it('still enforces the invariants on an edit', () => {
		expect(() => editDonationSlot(slot(), { capacity: 0 })).toThrow();
		expect(() => editDonationSlot(slot({ from: '09:00' }), { to: '08:00' })).toThrow();
		// Uncapping a pickup window would promise a vehicle the shelter does not have.
		expect(() => editDonationSlot(slot({ mode: 'pickup' }), { capacity: null })).toThrow();
	});

	it('lets a drop-off window drop its ceiling', () => {
		const uncapped = editDonationSlot(slot({ mode: 'dropoff' }), { capacity: null });
		expect(uncapped.capacity).toBeNull();
	});
});

describe('slot listing helpers', () => {
	const slots = [
		slot({ date: '2026-09-23', from: '09:00' }),
		slot({ date: '2026-09-22', from: '13:00' }),
		slot({ date: '2026-09-22', from: '09:00' }),
		slot({ date: '2026-09-22', from: '11:00', mode: 'dropoff', capacity: null })
	];

	it('lists one queue on one date, earliest first', () => {
		expect(slotsOnDate(slots, 'pickup', '2026-09-22').map((s) => s.from)).toEqual([
			'09:00',
			'13:00'
		]);
		expect(slotsOnDate(slots, 'dropoff', '2026-09-22').map((s) => s.from)).toEqual(['11:00']);
	});

	it('lists the dates that have windows in that queue, without duplicates', () => {
		expect(slotDates(slots, 'pickup')).toEqual(['2026-09-22', '2026-09-23']);
		expect(slotDates(slots, 'dropoff')).toEqual(['2026-09-22']);
	});
});

describe('parseCapacityInput', () => {
	it('reads every shape a number field hands over', () => {
		// Typed into the box — Svelte binds `<input type="number">` as a number.
		expect(parseCapacityInput(10)).toBe(10);
		// Emptied box, and the initial state before anyone typed.
		expect(parseCapacityInput(null)).toBeNull();
		expect(parseCapacityInput('')).toBeNull();
		expect(parseCapacityInput('   ')).toBeNull();
		// Change events still carry the raw string.
		expect(parseCapacityInput(' 4 ')).toBe(4);
	});

	it('hands unparseable text to the schema rather than guessing', () => {
		expect(parseCapacityInput('สิบ')).toBeNaN();
		expect(() =>
			createDonationSlot(
				{
					mode: 'pickup',
					date: '2026-09-22',
					from: '09:00',
					to: '10:00',
					capacity: parseCapacityInput('สิบ')
				},
				ctx
			)
		).toThrow();
	});
});
