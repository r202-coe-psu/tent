import { describe, expect, it } from 'vitest';
import { zoneOnDay } from './zone-on-day';

// Thai day 2026-11-09 ends at 2026-11-09T17:00Z.
const DAY = '2026-11-09';
const move = (occurred_at: string, zone: string | null, action = 'zone_change') => ({
	action,
	occurred_at,
	zone
});

describe('zoneOnDay', () => {
	it('is the zone of the latest movement that has one', () => {
		expect(
			zoneOnDay({
				day: DAY,
				movements: [move('2026-11-01T03:00:00Z', 'A'), move('2026-11-05T03:00:00Z', 'B')],
				currentZone: 'Z'
			})
		).toBe('B');
	});

	it('ignores a move to another zone after the selected day', () => {
		expect(
			zoneOnDay({
				day: DAY,
				movements: [move('2026-11-01T03:00:00Z', 'A'), move('2026-11-10T03:00:00Z', 'B')],
				currentZone: 'B'
			})
		).toBe('A');
	});

	it('includes a move late on the selected day and excludes midnight after it', () => {
		const movements = [move('2026-11-09T16:59:59Z', 'A'), move('2026-11-09T17:00:00Z', 'B')];
		expect(zoneOnDay({ day: DAY, movements, currentZone: 'B' })).toBe('A');
	});

	it('skips movements without a zone, such as a check-out', () => {
		expect(
			zoneOnDay({
				day: DAY,
				movements: [
					move('2026-11-01T03:00:00Z', 'A'),
					move('2026-11-08T03:00:00Z', null, 'check_out')
				],
				currentZone: 'Z'
			})
		).toBe('A');
		expect(
			zoneOnDay({ day: DAY, movements: [move('2026-11-01T03:00:00Z', '')], currentZone: 'Z' })
		).toBe('Z');
	});

	it('falls back to the current zone when no movement has one, and to null when nothing does', () => {
		expect(zoneOnDay({ day: DAY, movements: [], currentZone: 'Z' })).toBe('Z');
		expect(zoneOnDay({ day: DAY, movements: [], currentZone: null })).toBeNull();
		expect(zoneOnDay({ day: DAY, movements: [] })).toBeNull();
	});

	it('does not depend on the order the movements arrive in', () => {
		const movements = [move('2026-11-05T03:00:00Z', 'B'), move('2026-11-01T03:00:00Z', 'A')];
		expect(zoneOnDay({ day: DAY, movements, currentZone: 'Z' })).toBe('B');
	});
});
