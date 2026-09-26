import { describe, expect, it } from 'vitest';
import {
	DEFAULT_STORAGE_LABEL,
	lotStorageKey,
	lotStorageLabel,
	lotLocationFields,
	lotStorageName,
	storageLotFields
} from './lot-storage';
import { stockLotSchema } from './operations';

const points = [
	{ id: 'p1', name: 'ห้องเก็บของ 1' },
	{ id: 'p2', name: 'สนามปิงปอง' }
];

describe('lotStorageName', () => {
	it('prefers the current name of the referenced point (rename-safe)', () => {
		expect(lotStorageName({ storage_point_id: 'p1', storage_zone: 'ชื่อเก่า' }, points)).toBe(
			'ห้องเก็บของ 1'
		);
	});

	it('falls back to the storage_zone snapshot when the point was removed', () => {
		expect(lotStorageName({ storage_point_id: 'gone', storage_zone: 'ห้อง 9' }, points)).toBe(
			'ห้อง 9'
		);
	});

	it('reads a legacy location from lot.note', () => {
		expect(lotStorageName({ note: 'Zone A' })).toBe('Zone A');
	});

	it('never treats a workflow value in lot.note as a location', () => {
		for (const note of ['counter_loan_return', 'bulk_return_pool', 'distribution_return']) {
			expect(lotStorageName({ note })).toBeNull();
		}
	});

	it('returns null when nothing was recorded', () => {
		expect(lotStorageName(undefined)).toBeNull();
		expect(lotStorageName({})).toBeNull();
		expect(lotStorageName({ storage_zone: '  ' })).toBeNull();
	});
});

describe('lotStorageLabel', () => {
	it('uses คลังหลัก for an unspecified lot', () => {
		expect(lotStorageLabel({})).toBe(DEFAULT_STORAGE_LABEL);
		expect(lotStorageLabel({ storage_zone: 'ห้อง 9' })).toBe('ห้อง 9');
	});
});

describe('lotStorageKey', () => {
	it('keys by point id so a rename does not split the group', () => {
		expect(lotStorageKey({ storage_point_id: 'p1', storage_zone: 'ชื่อเก่า' })).toBe(
			lotStorageKey({ storage_point_id: 'p1', storage_zone: 'ชื่อใหม่' })
		);
	});

	it('keys a legacy note and a free-text storage_zone with the same name together', () => {
		expect(lotStorageKey({ note: 'Zone A' })).toBe(lotStorageKey({ storage_zone: 'Zone A' }));
	});

	it('gives unspecified lots (incl. workflow notes) the empty key', () => {
		expect(lotStorageKey({})).toBe('');
		expect(lotStorageKey({ note: 'counter_loan_return' })).toBe('');
	});
});

describe('storageLotFields', () => {
	it('writes id + name snapshot for a chosen point, nothing when unspecified', () => {
		expect(storageLotFields({ id: 'p1', name: ' ห้องเก็บของ 1 ' })).toEqual({
			storage_point_id: 'p1',
			storage_zone: 'ห้องเก็บของ 1'
		});
		expect(storageLotFields(null)).toEqual({});
	});
});

describe('stockLotSchema — storage_point_id (schema_v 5)', () => {
	it('accepts a point id with its name snapshot', () => {
		expect(stockLotSchema.parse({ storage_point_id: 'p1', storage_zone: 'ห้องเก็บของ 1' })).toEqual(
			{ storage_point_id: 'p1', storage_zone: 'ห้องเก็บของ 1' }
		);
	});

	it('rejects a point id without storage_zone', () => {
		expect(stockLotSchema.safeParse({ storage_point_id: 'p1' }).success).toBe(false);
	});

	it('still accepts legacy lots without a point id', () => {
		expect(stockLotSchema.safeParse({ note: 'Zone A' }).success).toBe(true);
		expect(stockLotSchema.safeParse({ storage_zone: 'A-01' }).success).toBe(true);
	});
});

describe('lotLocationFields', () => {
	it('keeps only location fields, in the shape the group was written with', () => {
		expect(
			lotLocationFields({ storage_point_id: 'p1', storage_zone: 'ห้อง 1', expiry: 'x', note: 'n' })
		).toEqual({ storage_point_id: 'p1', storage_zone: 'ห้อง 1' });
		expect(lotLocationFields({ storage_zone: ' A-01 ', lot_no: 'L-260101-001' })).toEqual({
			storage_zone: 'A-01'
		});
		expect(lotLocationFields({ note: 'Zone A' })).toEqual({ note: 'Zone A' });
		expect(lotLocationFields({ note: 'bulk_return_pool' })).toEqual({});
		expect(lotLocationFields(undefined)).toEqual({});
	});

	it('lands an adjustment in the same group as the source lot', () => {
		for (const lot of [
			{ storage_point_id: 'p1', storage_zone: 'ห้อง 1' },
			{ storage_zone: 'A-01' },
			{ note: 'Zone A' },
			{}
		]) {
			expect(lotStorageKey(lotLocationFields(lot))).toBe(lotStorageKey(lot));
		}
	});
});
