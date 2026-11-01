import { describe, expect, it } from 'vitest';
import {
	listDonationPoints,
	listStoragePoints,
	sortSubStorageTypes,
	SUB_STORAGE_TYPE_LABELS,
	subStorageTypeLabels
} from './storage-points';
import type { SubStorageType } from './schema';

describe('listStoragePoints', () => {
	it('returns [] for a missing shelter or missing common_areas', () => {
		expect(listStoragePoints(undefined)).toEqual([]);
		expect(listStoragePoints(null)).toEqual([]);
		expect(listStoragePoints({})).toEqual([]);
		expect(listStoragePoints({ common_areas: { sub_storage: null } })).toEqual([]);
	});

	it('keeps form order and drops rows that cannot be referenced', () => {
		const row = (id: string, name: string, type: SubStorageType) => ({
			id,
			name,
			types: [type],
			accepts_donations: false,
			lat: null,
			lng: null,
			location_note: null
		});
		const points = listStoragePoints({
			common_areas: {
				sub_storage: [
					row('b', 'คลังยา', 'medical_supplies'),
					row('', 'ไม่มีรหัส', 'general'),
					row('a', '  ', 'general'),
					row('c', 'สนามปิงปอง', 'food_dry')
				]
			}
		});
		expect(points.map((p) => p.id)).toEqual(['b', 'c']);
	});
});

describe('SUB_STORAGE_TYPE_LABELS', () => {
	it('labels every storage type (CR-199 — 7 values)', () => {
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

describe('sortSubStorageTypes', () => {
	it('returns enum order regardless of click order, without duplicates', () => {
		expect(sortSubStorageTypes(['drinking_water', 'general', 'baby_food', 'general'])).toEqual([
			'general',
			'baby_food',
			'drinking_water'
		]);
	});
});

describe('subStorageTypeLabels', () => {
	it('labels types in enum order', () => {
		expect(subStorageTypeLabels(['food_cold', 'drinking_water', 'baby_food'])).toEqual([
			'อาหารเด็ก',
			'อาหารแช่เย็น/แข็ง',
			'น้ำดื่ม'
		]);
	});
});

describe('listDonationPoints (CR-205)', () => {
	const point = (over: Record<string, unknown>) => ({
		id: 'p',
		name: 'จุด',
		types: ['general'],
		area_m2: null,
		accepts_donations: false,
		lat: null,
		lng: null,
		location_note: null,
		...over
	});

	it('returns [] without a shelter', () => {
		expect(listDonationPoints(undefined)).toEqual([]);
		expect(listDonationPoints(null)).toEqual([]);
	});

	it('keeps only ticked points that have a real pin, in form order', () => {
		const points = listDonationPoints({
			common_areas: {
				sub_storage: [
					point({ id: 'a', accepts_donations: true, lat: 7, lng: 100 }),
					point({ id: 'b', accepts_donations: true }),
					point({ id: 'c', lat: 7, lng: 100 }),
					point({ id: 'd', accepts_donations: true, lat: 0, lng: 0 }),
					point({ id: 'e', accepts_donations: true, lat: 0, lng: 100 })
				] as never
			}
		});
		expect(points.map((p) => p.id)).toEqual(['a', 'e']);
	});
});
