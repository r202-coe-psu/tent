import { describe, it, expect } from 'vitest';
import { sumZoneCapacities, capacityAlignment, canSyncCapacityFromZones } from './capacity-guide';

describe('sumZoneCapacities', () => {
	it('returns 0 for empty/null', () => {
		expect(sumZoneCapacities([])).toBe(0);
		expect(sumZoneCapacities(null)).toBe(0);
		expect(sumZoneCapacities(undefined)).toBe(0);
	});

	it('sums zone capacities, treating invalid as 0', () => {
		expect(sumZoneCapacities([{ capacity: 40 }, { capacity: 60 }])).toBe(100);
		expect(sumZoneCapacities([{ capacity: 40 }, { capacity: null }, {}])).toBe(40);
	});
});

describe('capacityAlignment', () => {
	it('reports no_zones when zone list is empty', () => {
		expect(capacityAlignment(100, 0, 0)).toBe('no_zones');
	});

	it('reports aligned / under / over', () => {
		expect(capacityAlignment(100, 100, 2)).toBe('aligned');
		expect(capacityAlignment(100, 80, 2)).toBe('zones_under');
		expect(capacityAlignment(100, 120, 2)).toBe('zones_over');
	});
});

describe('canSyncCapacityFromZones', () => {
	it('only when zones exist, sum > 0, and differs from shelter', () => {
		expect(canSyncCapacityFromZones(100, 80, 2)).toBe(true);
		expect(canSyncCapacityFromZones(100, 100, 2)).toBe(false);
		expect(canSyncCapacityFromZones(100, 0, 2)).toBe(false);
		expect(canSyncCapacityFromZones(100, 80, 0)).toBe(false);
	});
});
