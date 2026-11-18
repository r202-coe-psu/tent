import { describe, expect, it } from 'vitest';
import { filterShelterList } from './shelter-list-filter';

const shelters = [
	{ code: 'A', name: 'ศูนย์เปิด', site_kind: 'shelter', province: 'สงขลา' },
	{
		code: 'B',
		name: 'ศูนย์ซ่อน',
		site_kind: 'shelter',
		feature_flags: { public_visible: false }
	},
	{ code: 'C', name: 'ศูนย์ยกเลิก', site_kind: 'warehouse', operation_status: 'cancelled' },
	{ code: 'D', name: 'คลัง', site_kind: 'warehouse', district: 'หาดใหญ่' }
];

const all = { siteKind: 'all', hideHidden: false, query: '' };
const codes = (rows: { code: string }[]) => rows.map((r) => r.code);

describe('filterShelterList', () => {
	it('keeps every shelter by default, including hidden and cancelled', () => {
		expect(codes(filterShelterList(shelters, all))).toEqual(['A', 'B', 'C', 'D']);
	});

	it('hides non-public and cancelled shelters when hideHidden is on', () => {
		expect(codes(filterShelterList(shelters, { ...all, hideHidden: true }))).toEqual(['A', 'D']);
	});

	it('filters by site kind', () => {
		expect(codes(filterShelterList(shelters, { ...all, siteKind: 'warehouse' }))).toEqual([
			'C',
			'D'
		]);
	});

	it('combines hideHidden with site kind and search', () => {
		const result = filterShelterList(shelters, {
			siteKind: 'warehouse',
			hideHidden: true,
			query: ' หาดใหญ่ '
		});
		expect(codes(result)).toEqual(['D']);
	});

	it('searches name, code, province, district and subdistrict case-insensitively', () => {
		expect(codes(filterShelterList(shelters, { ...all, query: 'b' }))).toEqual(['B']);
		expect(codes(filterShelterList(shelters, { ...all, query: 'สงขลา' }))).toEqual(['A']);
	});
});
