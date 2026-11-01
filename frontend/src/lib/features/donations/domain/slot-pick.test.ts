import { describe, expect, it } from 'vitest';
import { pickedSlot, slotContextKey } from './slot-pick';

const slots = [
	{ label: '09:00-10:00', status: 'available' },
	{ label: '10:00-11:00', status: 'full' }
];
const dayA = slotContextKey('SH001', '2026-11-01', 'dropoff');

describe('pickedSlot', () => {
	it('keeps a window picked for this shelter, day and queue while it is open', () => {
		expect(pickedSlot({ slotTime: '09:00-10:00', slotFor: dayA, context: dayA, slots })).toBe(
			'09:00-10:00'
		);
	});

	it('drops the pick after the donor changes the day, even if the new day has that window', () => {
		const dayB = slotContextKey('SH001', '2026-11-02', 'dropoff');
		expect(pickedSlot({ slotTime: '09:00-10:00', slotFor: dayA, context: dayB, slots })).toBe('');
	});

	it('drops the pick after the donor changes shelter or delivery queue', () => {
		const otherShelter = slotContextKey('SH002', '2026-11-01', 'dropoff');
		const pickupQueue = slotContextKey('SH001', '2026-11-01', 'pickup');
		for (const context of [otherShelter, pickupQueue]) {
			expect(pickedSlot({ slotTime: '09:00-10:00', slotFor: dayA, context, slots })).toBe('');
		}
	});

	it('drops a window that filled or closed, and while the list is still loading', () => {
		expect(pickedSlot({ slotTime: '10:00-11:00', slotFor: dayA, context: dayA, slots })).toBe('');
		expect(pickedSlot({ slotTime: '09:00-10:00', slotFor: dayA, context: dayA, slots: [] })).toBe(
			''
		);
	});

	it('is empty when nothing was picked', () => {
		expect(pickedSlot({ slotTime: '', slotFor: '', context: dayA, slots })).toBe('');
	});
});
