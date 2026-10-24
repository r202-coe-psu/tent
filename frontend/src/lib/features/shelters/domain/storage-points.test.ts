import { describe, expect, it } from 'vitest';
import { listStoragePoints, SUB_STORAGE_TYPE_LABELS } from './storage-points';

describe('listStoragePoints', () => {
	it('returns [] for a missing shelter or missing common_areas', () => {
		expect(listStoragePoints(undefined)).toEqual([]);
		expect(listStoragePoints(null)).toEqual([]);
		expect(listStoragePoints({})).toEqual([]);
		expect(listStoragePoints({ common_areas: { sub_storage: null } })).toEqual([]);
	});

	it('keeps form order and drops rows that cannot be referenced', () => {
		const points = listStoragePoints({
			common_areas: {
				sub_storage: [
					{ id: 'b', name: 'คลังยา', types: ['medical_supplies'] },
					{ id: '', name: 'ไม่มีรหัส', types: ['general'] },
					{ id: 'a', name: '  ', types: ['general'] },
					{ id: 'c', name: 'สนามปิงปอง', types: ['food_dry'] }
				]
			}
		});
		expect(points.map((p) => p.id)).toEqual(['b', 'c']);
	});
});

describe('SUB_STORAGE_TYPE_LABELS', () => {
	it('labels every storage type (CR-175 — 7 values)', () => {
		expect(Object.keys(SUB_STORAGE_TYPE_LABELS).sort()).toEqual(
			[
				'general',
				'baby_food',
				'food_dry',
				'cooked_food',
				'food_cold',
				'medical_supplies',
				'drinking_water'
			].sort()
		);
	});
});
