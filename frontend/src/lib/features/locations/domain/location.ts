import { z } from 'zod';
import { type CatalogDoc, catalogDoc, makeDocId } from '$lib/db/model';

/**
 * Thailand administrative location reference data — province / district /
 * subdistrict (+ postal code), stored in the central `registry` database and
 * read through the BFF (`/api/v1/thailand-location/*`). CR-037.
 *
 * Modeled MongoDB-style: each child doc carries its parent doc `_id` as a
 * foreign key (`province_id` on district, `district_id` on subdistrict) queried
 * via a Mango index — CouchDB has no joins. `_id` is a deterministic hierarchical
 * key derived from the natural name path so re-seeding is idempotent (no ULID).
 *
 * Pure: no I/O, no server-only imports — safe for both the BFF and the seed
 * script to depend on.
 */

export const LOCATION_DB = 'registry';
export const LOCATION_SCHEMA_V = 1;

export const PROVINCE_TYPE = 'location_province';
export const DISTRICT_TYPE = 'location_district';
export const SUBDISTRICT_TYPE = 'location_subdistrict';

// ── deterministic `_id` helpers (natural-key path) ──────────────────────────

/** `location_province:{province}` */
export function provinceDocId(province: string): string {
	return makeDocId(PROVINCE_TYPE, province);
}

/** `location_district:{province}:{district}` */
export function districtDocId(province: string, district: string): string {
	return makeDocId(DISTRICT_TYPE, `${province}:${district}`);
}

/** `location_subdistrict:{province}:{district}:{subdistrict}` */
export function subdistrictDocId(province: string, district: string, subdistrict: string): string {
	return makeDocId(SUBDISTRICT_TYPE, `${province}:${district}:${subdistrict}`);
}

// ── persisted doc shapes (registry envelope: no shelter_code) ────────────────

export interface ProvinceDoc extends CatalogDoc {
	type: typeof PROVINCE_TYPE;
	name: string;
}

export interface DistrictDoc extends CatalogDoc {
	type: typeof DISTRICT_TYPE;
	name: string;
	/** denormalized parent province name (immutable reference data) */
	province: string;
	/** `_id` of the parent `location_province` doc */
	province_id: string;
}

export interface SubdistrictDoc extends CatalogDoc {
	type: typeof SUBDISTRICT_TYPE;
	name: string;
	/** denormalized ancestor names (immutable reference data) */
	province: string;
	district: string;
	/** `_id` of the parent `location_district` doc */
	district_id: string;
	/** 5-digit Thai postal code (10100–96220 — lossless as a number) */
	zipcode: number;
}

export type LocationDoc = ProvinceDoc | DistrictDoc | SubdistrictDoc;

// ── zod schemas ──────────────────────────────────────────────────────────────

export const provinceDocSchema = z.object({
	_id: z.string().startsWith(`${PROVINCE_TYPE}:`),
	type: z.literal(PROVINCE_TYPE),
	schema_v: z.literal(LOCATION_SCHEMA_V),
	name: z.string().trim().min(1)
});

export const districtDocSchema = z.object({
	_id: z.string().startsWith(`${DISTRICT_TYPE}:`),
	type: z.literal(DISTRICT_TYPE),
	schema_v: z.literal(LOCATION_SCHEMA_V),
	name: z.string().trim().min(1),
	province: z.string().trim().min(1),
	province_id: z.string().startsWith(`${PROVINCE_TYPE}:`)
});

export const subdistrictDocSchema = z.object({
	_id: z.string().startsWith(`${SUBDISTRICT_TYPE}:`),
	type: z.literal(SUBDISTRICT_TYPE),
	schema_v: z.literal(LOCATION_SCHEMA_V),
	name: z.string().trim().min(1),
	province: z.string().trim().min(1),
	district: z.string().trim().min(1),
	district_id: z.string().startsWith(`${DISTRICT_TYPE}:`),
	zipcode: z.number().int()
});

// ── type guards ──────────────────────────────────────────────────────────────

export function isProvinceDoc(d: unknown): d is ProvinceDoc {
	return provinceDocSchema.safeParse(d).success;
}

export function isDistrictDoc(d: unknown): d is DistrictDoc {
	return districtDocSchema.safeParse(d).success;
}

export function isSubdistrictDoc(d: unknown): d is SubdistrictDoc {
	return subdistrictDocSchema.safeParse(d).success;
}

// ── single-doc factories ─────────────────────────────────────────────────────

export function makeProvinceDoc(name: string, createdBy = 'seed'): ProvinceDoc {
	return catalogDoc(PROVINCE_TYPE, LOCATION_SCHEMA_V, { name }, createdBy, name);
}

export function makeDistrictDoc(province: string, name: string, createdBy = 'seed'): DistrictDoc {
	return catalogDoc(
		DISTRICT_TYPE,
		LOCATION_SCHEMA_V,
		{ name, province, province_id: provinceDocId(province) },
		createdBy,
		`${province}:${name}`
	);
}

export function makeSubdistrictDoc(
	province: string,
	district: string,
	name: string,
	zipcode: number,
	createdBy = 'seed'
): SubdistrictDoc {
	return catalogDoc(
		SUBDISTRICT_TYPE,
		LOCATION_SCHEMA_V,
		{ name, province, district, district_id: districtDocId(province, district), zipcode },
		createdBy,
		`${province}:${district}:${name}`
	);
}

// ── flat record (API contract shape — unchanged from the legacy JSON) ────────

export interface LocationRow {
	province: string;
	district: string;
	subdistrict: string;
	zipcode: number;
}

/**
 * Expand flat `{ province, district, subdistrict, zipcode }` rows into the three
 * deduped doc levels ready for a bulk seed. Deterministic + idempotent: the same
 * rows always produce the same `_id`s.
 */
export function buildLocationDocs(
	rows: LocationRow[],
	createdBy = 'seed'
): { provinces: ProvinceDoc[]; districts: DistrictDoc[]; subdistricts: SubdistrictDoc[] } {
	const provinces = new Map<string, ProvinceDoc>();
	const districts = new Map<string, DistrictDoc>();
	const subdistricts = new Map<string, SubdistrictDoc>();

	for (const row of rows) {
		const { province, district, subdistrict, zipcode } = row;

		if (!provinces.has(province)) provinces.set(province, makeProvinceDoc(province, createdBy));

		const dKey = `${province}:${district}`;
		if (!districts.has(dKey)) districts.set(dKey, makeDistrictDoc(province, district, createdBy));

		const sKey = `${province}:${district}:${subdistrict}`;
		if (!subdistricts.has(sKey))
			subdistricts.set(
				sKey,
				makeSubdistrictDoc(province, district, subdistrict, zipcode, createdBy)
			);
	}

	return {
		provinces: [...provinces.values()],
		districts: [...districts.values()],
		subdistricts: [...subdistricts.values()]
	};
}
