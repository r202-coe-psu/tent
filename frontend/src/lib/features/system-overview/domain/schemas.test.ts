import { describe, expect, it } from 'vitest';
import {
	ageBandForBirthYear,
	defaultMovementDateRange,
	forecastFromCounts,
	overviewFiltersSchema,
	pct,
	presentFromCounts,
	resolveMovementDateRange,
	thailandDateString
} from './schemas';

describe('presentFromCounts / forecastFromCounts (CR-112)', () => {
	it('counts Present as active + room_confirmed + temporary_leave', () => {
		expect(
			presentFromCounts({
				active: 10,
				room_confirmed: 2,
				temporary_leave: 1,
				pre_registered: 5,
				arriving: 3
			})
		).toBe(13);
	});

	it('counts Forecast as Present + pre_registered + arriving', () => {
		expect(
			forecastFromCounts({
				active: 10,
				room_confirmed: 2,
				temporary_leave: 1,
				pre_registered: 5,
				arriving: 3
			})
		).toBe(21);
	});
});

describe('ageBandForBirthYear', () => {
	it('buckets Thai Buddhist Era birth years', () => {
		const year = 2026;
		expect(ageBandForBirthYear(2565, year)).toBe('1-5'); // age 4
		expect(ageBandForBirthYear(2550, year)).toBe('12-19'); // age 19
		expect(ageBandForBirthYear(2546, year)).toBe('20-59'); // age 23
		expect(ageBandForBirthYear(null)).toBe('unknown');
	});
});

describe('pct', () => {
	it('returns null for zero capacity', () => {
		expect(pct(10, 0)).toBeNull();
	});
	it('rounds to one decimal', () => {
		expect(pct(1, 3)).toBe(33.3);
	});
});

describe('overviewFiltersSchema', () => {
	it('applies defaults', () => {
		const f = overviewFiltersSchema.parse({});
		expect(f.movement_window).toBe('today');
		expect(f.stay_bucket).toBe('all');
		expect(f.source).toBe('all');
		expect(f.limit).toBe(50);
		expect(f.offset).toBe(0);
		expect(f.movement_from).toBeUndefined();
		expect(f.movement_to).toBeUndefined();
	});
});

describe('resolveMovementDateRange', () => {
	it('prefers explicit from/to and normalizes order', () => {
		expect(
			resolveMovementDateRange({
				movement_from: '2026-09-10',
				movement_to: '2026-09-05',
				movement_window: 'today'
			})
		).toEqual({ from: '2026-09-05', to: '2026-09-10' });
	});
});

describe('defaultMovementDateRange', () => {
	it('returns inclusive 14-day window ending on the Thailand calendar day', () => {
		// 2026-09-16 12:00 UTC → 2026-09-16 19:00 in UTC+7 → Thailand day 2026-09-16
		const { from, to } = defaultMovementDateRange(new Date('2026-09-16T12:00:00.000Z'));
		expect(to).toBe('2026-09-16');
		expect(from).toBe('2026-09-03'); // today − 13 days
		expect(thailandDateString(new Date('2026-09-16T12:00:00.000Z'))).toBe(to);
	});

	it('returns YYYY-MM-DD strings with from <= to', () => {
		const { from, to } = defaultMovementDateRange();
		expect(from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
		expect(from <= to).toBe(true);
	});
});
