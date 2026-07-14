import { describe, it, expect } from 'vitest';
import {
	buildLocationDocs,
	provinceDocId,
	districtDocId,
	subdistrictDocId,
	isProvinceDoc,
	isDistrictDoc,
	isSubdistrictDoc,
	type LocationRow
} from './location';

const ROWS: LocationRow[] = [
	{ province: 'ก', district: 'ด1', subdistrict: 'ต1', zipcode: 10001 },
	{ province: 'ก', district: 'ด1', subdistrict: 'ต2', zipcode: 10002 },
	{ province: 'ก', district: 'ด2', subdistrict: 'ต3', zipcode: 10003 },
	// same district name under a different province — distinct doc
	{ province: 'ข', district: 'ด1', subdistrict: 'ต4', zipcode: 20001 }
];

describe('id helpers', () => {
	it('build deterministic hierarchical ids', () => {
		expect(provinceDocId('ก')).toBe('location_province:ก');
		expect(districtDocId('ก', 'ด1')).toBe('location_district:ก:ด1');
		expect(subdistrictDocId('ก', 'ด1', 'ต1')).toBe('location_subdistrict:ก:ด1:ต1');
	});
});

describe('buildLocationDocs', () => {
	const { provinces, districts, subdistricts } = buildLocationDocs(ROWS);

	it('dedupes each level', () => {
		expect(provinces).toHaveLength(2); // ก, ข
		expect(districts).toHaveLength(3); // ก:ด1, ก:ด2, ข:ด1
		expect(subdistricts).toHaveLength(4);
	});

	it('links children to parents via foreign-key _id', () => {
		const d = districts.find((x) => x._id === districtDocId('ก', 'ด1'))!;
		expect(d.province_id).toBe(provinceDocId('ก'));
		const s = subdistricts.find((x) => x._id === subdistrictDocId('ก', 'ด1', 'ต1'))!;
		expect(s.district_id).toBe(districtDocId('ก', 'ด1'));
		expect(s.zipcode).toBe(10001);
	});

	it('keeps same-named districts under different provinces distinct', () => {
		expect(districtDocId('ก', 'ด1')).not.toBe(districtDocId('ข', 'ด1'));
	});

	it('is idempotent — same rows produce the same ids', () => {
		const again = buildLocationDocs(ROWS);
		expect(again.subdistricts.map((s) => s._id)).toEqual(subdistricts.map((s) => s._id));
	});

	it('produces docs that satisfy their type guards', () => {
		expect(provinces.every(isProvinceDoc)).toBe(true);
		expect(districts.every(isDistrictDoc)).toBe(true);
		expect(subdistricts.every(isSubdistrictDoc)).toBe(true);
	});
});
