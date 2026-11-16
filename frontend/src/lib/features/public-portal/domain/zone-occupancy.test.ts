import { describe, expect, it } from 'vitest';
import { publicZoneOccupancy } from './zone-occupancy';

describe('publicZoneOccupancy', () => {
	it('is null until the worker has projected per-zone counts', () => {
		expect(publicZoneOccupancy({ present: null, capacity: 10 })).toBeNull();
		expect(publicZoneOccupancy({ capacity: 10 })).toBeNull();
	});

	it('shows an empty zone as 0 of capacity', () => {
		expect(publicZoneOccupancy({ present: 0, capacity: 10 })).toEqual({
			present: 0,
			capacity: 10,
			percent: 0,
			level: 'normal'
		});
	});

	it('warns from 80% and is full from 100%', () => {
		expect(publicZoneOccupancy({ present: 7, capacity: 10 })?.level).toBe('normal');
		expect(publicZoneOccupancy({ present: 8, capacity: 10 })?.level).toBe('warning');
		expect(publicZoneOccupancy({ present: 10, capacity: 10 })?.level).toBe('full');
	});

	it('does not clamp an overfull zone', () => {
		expect(publicZoneOccupancy({ present: 12, capacity: 10 })).toMatchObject({
			percent: 120,
			level: 'full'
		});
	});

	it('treats a non-positive capacity as full without throwing', () => {
		expect(publicZoneOccupancy({ present: 3, capacity: 0 })).toEqual({
			present: 3,
			capacity: 0,
			percent: 0,
			level: 'full'
		});
	});

	it('gives no percent or level when the capacity is unknown', () => {
		const expected = { present: 3, capacity: null, percent: null, level: null };
		expect(publicZoneOccupancy({ present: 3, capacity: null })).toEqual(expected);
		expect(publicZoneOccupancy({ present: 3 })).toEqual(expected);
	});
});
