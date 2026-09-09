import { describe, expect, it } from 'vitest';
import {
	countVulnerableFromBirthYearRows,
	isValidThaiBirthYear,
	occupancyTripleFromStatusRows,
	sumInZoneFromStatusRows,
	sumOccupancyFromStatusRows,
	sumPresentFromStatusRows
} from './transparency-metrics';

describe('transparency metrics', () => {
	it('accepts only integer Buddhist Era birth years in the expected range', () => {
		expect(isValidThaiBirthYear(2563)).toBe(true);
		expect(isValidThaiBirthYear(2020)).toBe(false);
		expect(isValidThaiBirthYear(2600)).toBe(false);
		expect(isValidThaiBirthYear('2563')).toBe(false);
	});

	it('does not classify a Gregorian year as a vulnerable age', () => {
		expect(
			countVulnerableFromBirthYearRows(
				[null, { key: 2020, value: 6 }, { key: 2563, value: 5 }, { key: 2500, value: 2 }],
				2026
			)
		).toBe(2);
	});

	it('counts children and older adults from valid Buddhist Era years', () => {
		expect(
			countVulnerableFromBirthYearRows(
				[
					{ key: 2565, value: 3 },
					{ key: 2480, value: 4 },
					{ key: null, value: 10 },
					{ key: 2563, value: -1 }
				],
				2026
			)
		).toBe(7);
	});
});

describe('occupancy triple (CR-112 Forecast / Present / In-zone)', () => {
	const rows = [
		{ key: 'pre_registered', value: 2 },
		{ key: 'arriving', value: 1 },
		{ key: 'active', value: 3 },
		{ key: 'room_confirmed', value: 4 },
		{ key: 'temporary_leave', value: 1 },
		{ key: 'cancelled', value: 9 },
		{ key: 'checked_out', value: 4 },
		{ key: 'transferred', value: 2 },
		{ key: 'deceased', value: 1 }
	];

	it('Forecast occupancy counts pre_registered, arriving, active, room_confirmed, temporary_leave', () => {
		// 2+1+3+4+1 = 11; terminal statuses excluded
		expect(sumOccupancyFromStatusRows(rows)).toBe(11);
	});

	it('Present counts active, room_confirmed, temporary_leave only', () => {
		expect(sumPresentFromStatusRows(rows)).toBe(8);
	});

	it('In-zone counts room_confirmed only', () => {
		expect(sumInZoneFromStatusRows(rows)).toBe(4);
	});

	it('returns the additive triple together', () => {
		expect(occupancyTripleFromStatusRows(rows)).toEqual({
			occupancy: 11,
			present: 8,
			in_zone: 4
		});
	});

	it('returns zeros when nothing holds a place', () => {
		expect(sumOccupancyFromStatusRows([{ key: 'cancelled', value: 9 }])).toBe(0);
		expect(occupancyTripleFromStatusRows([])).toEqual({
			occupancy: 0,
			present: 0,
			in_zone: 0
		});
	});

	it('tolerates a missing or malformed view payload', () => {
		expect(sumOccupancyFromStatusRows(undefined)).toBe(0);
		expect(sumOccupancyFromStatusRows(null)).toBe(0);
		expect(sumOccupancyFromStatusRows('nope')).toBe(0);
		expect(sumOccupancyFromStatusRows([null, 'x', 42])).toBe(0);
	});

	it('skips rows whose value is not a usable count', () => {
		const bad = [
			{ key: 'active', value: 3 },
			{ key: 'pre_registered', value: -1 },
			{ key: 'active', value: Number.NaN },
			{ key: 'active', value: '7' },
			{ key: 'room_confirmed', value: 2 }
		];
		expect(sumOccupancyFromStatusRows(bad)).toBe(5);
		expect(sumPresentFromStatusRows(bad)).toBe(5);
		expect(sumInZoneFromStatusRows(bad)).toBe(2);
	});
});
