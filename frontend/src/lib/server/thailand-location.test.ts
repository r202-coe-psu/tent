import { describe, it, expect, vi } from 'vitest';

const FIXTURE = [
	{ province: 'B-Province', district: 'B-District', subdistrict: 'B-Sub', zipcode: 20000 },
	{ province: 'A-Province', district: 'A-District-2', subdistrict: 'A-Sub-2', zipcode: 10002 },
	{ province: 'A-Province', district: 'A-District-1', subdistrict: 'A-Sub-1', zipcode: 10001 },
	{ province: 'A-Province', district: 'A-District-1', subdistrict: 'A-Sub-1-Dup', zipcode: 10001 },
	// same district name reused under a different province — must not leak across provinces
	{ province: 'B-Province', district: 'A-District-1', subdistrict: 'B-Sub-2', zipcode: 20001 }
];

vi.mock('../../../static/data/thailand_location_data.json', () => ({
	default: FIXTURE
}));

const { listProvinces, listDistricts, listSubdistricts } = await import('./thailand-location');

describe('listProvinces', () => {
	it('returns deduped provinces sorted alphabetically', () => {
		expect(listProvinces()).toEqual(['A-Province', 'B-Province']);
	});
});

describe('listDistricts', () => {
	it('returns deduped districts for the given province, sorted', () => {
		expect(listDistricts('A-Province')).toEqual(['A-District-1', 'A-District-2']);
	});

	it('does not leak districts from another province with the same name', () => {
		expect(listDistricts('B-Province')).toEqual(['A-District-1', 'B-District']);
	});

	it('returns an empty array for an unknown province', () => {
		expect(listDistricts('Nonexistent')).toEqual([]);
	});
});

describe('listSubdistricts', () => {
	it('returns subdistrict + zipcode pairs for the given province/district, sorted by name', () => {
		expect(listSubdistricts('A-Province', 'A-District-1')).toEqual([
			{ subdistrict: 'A-Sub-1', zipcode: 10001 },
			{ subdistrict: 'A-Sub-1-Dup', zipcode: 10001 }
		]);
	});

	it('scopes by both province and district, not district alone', () => {
		expect(listSubdistricts('B-Province', 'A-District-1')).toEqual([
			{ subdistrict: 'B-Sub-2', zipcode: 20001 }
		]);
	});

	it('returns an empty array for an unknown province/district combination', () => {
		expect(listSubdistricts('A-Province', 'Nonexistent')).toEqual([]);
	});
});
