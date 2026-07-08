/**
 * Thailand province/district/subdistrict lookup — backs the cascading address
 * selects on the shelter form (province → district → subdistrict). Source data
 * is the static reference dataset at `static/data/thailand_location_data.json`
 * (flat rows of `{ province, district, subdistrict, zipcode }`), imported once
 * at module load and indexed in memory — this is read-only reference data, not
 * a persisted domain doc, so it deliberately bypasses PouchDB/CouchDB.
 */

import rows from '../../../static/data/thailand_location_data.json';

interface LocationRow {
	province: string;
	district: string;
	subdistrict: string;
	zipcode: number;
}

const DATA = rows as LocationRow[];

const thCompare = (a: string, b: string) => a.localeCompare(b, 'th');

export function listProvinces(): string[] {
	return [...new Set(DATA.map((r) => r.province))].sort(thCompare);
}

export function listDistricts(province: string): string[] {
	return [...new Set(DATA.filter((r) => r.province === province).map((r) => r.district))].sort(
		thCompare
	);
}

export interface Subdistrict {
	subdistrict: string;
	zipcode: number;
}

export function listSubdistricts(province: string, district: string): Subdistrict[] {
	return DATA.filter((r) => r.province === province && r.district === district)
		.map((r) => ({ subdistrict: r.subdistrict, zipcode: r.zipcode }))
		.sort((a, b) => thCompare(a.subdistrict, b.subdistrict));
}
