import { describe, expect, it } from 'vitest';
import { wasInShelterAllDay } from './in-shelter-day';

const DAY = '2026-11-09';
// Thai day 2026-11-09 = 2026-11-08T17:00Z .. 2026-11-09T17:00Z
const at = (iso: string) => ({ occurred_at: iso });

describe('wasInShelterAllDay (Thai calendar day, from movement history)', () => {
	it('is true when checked in before the day and never leaves', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [{ action: 'check_in', ...at('2026-11-07T03:00:00Z') }]
			})
		).toBe(true);
	});

	it('is false when the check-in happens during the day', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [{ action: 'check_in', ...at('2026-11-09T06:00:00Z') }]
			})
		).toBe(false);
	});

	it('is false when the person checks out during the day', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'check_out', ...at('2026-11-09T05:00:00Z') }
				]
			})
		).toBe(false);
	});

	it('is false for someone who checked out the previous evening', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'check_out', ...at('2026-11-08T16:00:00Z') }
				]
			})
		).toBe(false);
	});

	it('keeps counting someone who checks out after the day ended', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'check_out', ...at('2026-11-10T01:00:00Z') }
				]
			})
		).toBe(true);
	});

	it('is false for a temporary leave and return inside the day', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'leave_temporary', ...at('2026-11-09T02:00:00Z') },
					{ action: 'return_from_leave', ...at('2026-11-09T08:00:00Z') }
				]
			})
		).toBe(false);
	});

	it('ignores zone changes and room confirmation during the day', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'zone_change', ...at('2026-11-09T02:00:00Z') },
					{ action: 'confirm_room', ...at('2026-11-09T03:00:00Z') }
				]
			})
		).toBe(true);
	});

	it('uses the Thai day boundary (17:00Z is already the next Thai day)', () => {
		const movements = [
			{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
			{ action: 'check_out', ...at('2026-11-08T17:30:00Z') }
		];
		expect(wasInShelterAllDay({ day: DAY, movements })).toBe(false);
		expect(wasInShelterAllDay({ day: '2026-11-08', movements })).toBe(true);
	});

	it('handles unordered movements', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [
					{ action: 'check_out', ...at('2026-11-09T05:00:00Z') },
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') }
				]
			})
		).toBe(false);
	});

	it('falls back to current_stay when there are no movements', () => {
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [],
				current_stay: { status: 'active', since: '2026-11-07T03:00:00Z' }
			})
		).toBe(true);
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [],
				current_stay: { status: 'active', since: '2026-11-09T03:00:00Z' }
			})
		).toBe(false);
		expect(
			wasInShelterAllDay({
				day: DAY,
				movements: [],
				current_stay: { status: 'checked_out', since: '2026-11-07T03:00:00Z' }
			})
		).toBe(false);
	});

	it('is false when nothing is known', () => {
		expect(wasInShelterAllDay({ day: DAY, movements: [] })).toBe(false);
	});
});

describe('wasInShelterAllDay for a day that is still running', () => {
	// Today is 2026-11-09 and it is only 10:00 Thai (03:00Z): the day has no end yet.
	const TODAY = '2026-11-09';

	it('counts someone who checked in before today and has not left', () => {
		expect(
			wasInShelterAllDay({
				day: TODAY,
				movements: [{ action: 'check_in', ...at('2026-11-07T03:00:00Z') }]
			})
		).toBe(true);
	});

	it('does not count someone who checked in this morning', () => {
		expect(
			wasInShelterAllDay({
				day: TODAY,
				movements: [{ action: 'check_in', ...at('2026-11-09T01:00:00Z') }]
			})
		).toBe(false);
	});

	it('does not count someone who left earlier today', () => {
		expect(
			wasInShelterAllDay({
				day: TODAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'check_out', ...at('2026-11-09T02:00:00Z') }
				]
			})
		).toBe(false);
	});

	it('counts someone who only changed zone this morning', () => {
		expect(
			wasInShelterAllDay({
				day: TODAY,
				movements: [
					{ action: 'check_in', ...at('2026-11-07T03:00:00Z') },
					{ action: 'zone_change', ...at('2026-11-09T02:00:00Z') }
				]
			})
		).toBe(true);
	});
});
