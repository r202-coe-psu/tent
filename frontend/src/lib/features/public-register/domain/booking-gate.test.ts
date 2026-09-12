import { describe, expect, it } from 'vitest';
import {
	findDuplicateHold,
	holdConflictsWithBooking,
	isActiveHoldStatus,
	isForecastCapacityExceeded
} from './booking-gate';

describe('isForecastCapacityExceeded (CR-112)', () => {
	it('blocks when Forecast + party would exceed capacity', () => {
		expect(isForecastCapacityExceeded(98, 100, 3)).toBe(true);
		expect(isForecastCapacityExceeded(97, 100, 3)).toBe(false);
		expect(isForecastCapacityExceeded(100, 100, 1)).toBe(true);
	});

	it('does not block when capacity is unknown or zero', () => {
		expect(isForecastCapacityExceeded(50, 0, 10)).toBe(false);
		expect(isForecastCapacityExceeded(50, -1, 10)).toBe(false);
	});
});

describe('duplicate hold identity (CR-112)', () => {
	it('treats Forecast stay statuses as active holds', () => {
		expect(isActiveHoldStatus('pre_registered')).toBe(true);
		expect(isActiveHoldStatus('room_confirmed')).toBe(true);
		expect(isActiveHoldStatus('cancelled')).toBe(false);
		expect(isActiveHoldStatus('checked_out')).toBe(false);
	});

	it('matches on phone across non-cancelled holds', () => {
		expect(
			holdConflictsWithBooking(
				{
					current_stay: { status: 'pre_registered' },
					phone: '081-234-5678'
				},
				{ phone: '0812345678' }
			)
		).toBe(true);
	});

	it('matches on card number or Anonymous ID', () => {
		expect(
			holdConflictsWithBooking(
				{
					current_stay: { status: 'arriving' },
					person_id: { number: 'ANON-01HTEST000000000000000000' }
				},
				{ cardNumber: 'anon-01htest000000000000000000' }
			)
		).toBe(true);
		expect(
			holdConflictsWithBooking(
				{
					current_stay: { status: 'active' },
					person_id: { number: '1234567890123' }
				},
				{ cardNumber: '1234567890123' }
			)
		).toBe(true);
	});

	it('ignores cancelled / terminal stays even when identity matches', () => {
		expect(
			holdConflictsWithBooking(
				{ current_stay: { status: 'cancelled' }, phone: '0812345678' },
				{ phone: '0812345678' }
			)
		).toBe(false);
	});

	it('findDuplicateHold returns the first conflicting hold', () => {
		const hit = findDuplicateHold(
			[
				{ current_stay: { status: 'cancelled' }, phone: '0812345678' },
				{ current_stay: { status: 'pre_registered' }, phone: '0812345678' }
			],
			{ phone: '0812345678' }
		);
		expect(hit?.current_stay?.status).toBe('pre_registered');
	});
});
