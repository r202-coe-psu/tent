import { describe, it, expect } from 'vitest';
import { sumZoneAreas, sumCommonAreas, areaAlignment, canSyncAreaFromZones } from './area-guide';

describe('sumZoneAreas', () => {
	it('returns 0 for empty/null', () => {
		expect(sumZoneAreas([])).toBe(0);
		expect(sumZoneAreas(null)).toBe(0);
		expect(sumZoneAreas(undefined)).toBe(0);
	});

	it('sums zone areas, treating invalid or null as 0', () => {
		expect(sumZoneAreas([{ area_m2: 120 }, { area_m2: 80 }])).toBe(200);
		expect(sumZoneAreas([{ area_m2: 50.5 }, { area_m2: null }, {}])).toBe(50.5);
	});

	it('rounds to 2 decimal places to avoid floating point precision issues', () => {
		expect(sumZoneAreas([{ area_m2: 0.1 }, { area_m2: 0.2 }])).toBe(0.3);
		expect(sumZoneAreas([{ area_m2: 10.333 }, { area_m2: 20.666 }])).toBe(31);
	});
});

describe('sumCommonAreas', () => {
	it('returns 0 for null/undefined/empty', () => {
		expect(sumCommonAreas(null)).toBe(0);
		expect(sumCommonAreas(undefined)).toBe(0);
		expect(sumCommonAreas({})).toBe(0);
		expect(sumCommonAreas({ sub_storage: [] })).toBe(0);
	});

	it('sums sub-storage and logistics area correctly', () => {
		expect(
			sumCommonAreas({
				sub_storage: [{ area_m2: 25 }, { area_m2: 35.5 }],
				logistics_area_m2: 100
			})
		).toBe(160.5);
	});
});

describe('areaAlignment', () => {
	it('reports no_zones when zone list is empty or sum is 0', () => {
		expect(areaAlignment(100, 0, 0)).toBe('no_zones');
		expect(areaAlignment(100, 0, 2)).toBe('no_zones');
	});

	it('reports aligned / under / over', () => {
		expect(areaAlignment(100, 100, 2)).toBe('aligned');
		expect(areaAlignment(100.5, 100.5, 2)).toBe('aligned');
		expect(areaAlignment(100, 80, 2)).toBe('zones_under');
		expect(areaAlignment(100, 120, 2)).toBe('zones_over');
	});
});

describe('canSyncAreaFromZones', () => {
	it('only when zones exist, sum > 0, and differs from shelter area', () => {
		expect(canSyncAreaFromZones(100, 80, 2)).toBe(true);
		expect(canSyncAreaFromZones(null, 80, 2)).toBe(true);
		expect(canSyncAreaFromZones(0, 80, 2)).toBe(true);
		expect(canSyncAreaFromZones(100, 100, 2)).toBe(false);
		expect(canSyncAreaFromZones(100, 0, 2)).toBe(false);
		expect(canSyncAreaFromZones(100, 80, 0)).toBe(false);
	});
});
