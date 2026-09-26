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
					{ id: 'b', name: 'คลังยา', type: 'medical_supplies' },
					{ id: '', name: 'ไม่มีรหัส', type: 'general' },
					{ id: 'a', name: '  ', type: 'general' },
					{ id: 'c', name: 'สนามปิงปอง', type: 'food_dry' }
				]
			}
		});
		expect(points.map((p) => p.id)).toEqual(['b', 'c']);
	});
});

describe('SUB_STORAGE_TYPE_LABELS', () => {
	it('labels every storage type', () => {
		expect(Object.keys(SUB_STORAGE_TYPE_LABELS).sort()).toEqual(
			['drinking_water', 'food_dry', 'general', 'medical_supplies'].sort()
		);
	});
});
