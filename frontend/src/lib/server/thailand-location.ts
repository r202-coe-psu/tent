/**
 * Thailand province/district/subdistrict lookup — backs the cascading address
 * selects on the shelter form and the combined search-select on the household
 * register form.
 *
 * Reference data lives in the central `registry` database as three doc levels
 * (`location_province` / `location_district` / `location_subdistrict`), modeled
 * MongoDB-style (child docs carry a parent `_id` foreign key queried via a Mango
 * index). CR-037 moved this off the bundled static JSON so it can be edited
 * centrally without a redeploy. Seed with `pnpm seed:thailand`.
 *
 * Server-only: uses the CouchDB admin client. Never import from a client bundle.
 */

import { adminRaw, ServiceError } from './couch-admin';
import {
	LOCATION_DB,
	PROVINCE_TYPE,
	DISTRICT_TYPE,
	SUBDISTRICT_TYPE,
	districtDocId,
	provinceDocId,
	subdistrictDocId,
	makeProvinceDoc,
	makeDistrictDoc,
	makeSubdistrictDoc,
	isProvinceDoc,
	isDistrictDoc,
	isSubdistrictDoc,
	type ProvinceDoc,
	type DistrictDoc,
	type SubdistrictDoc,
	type LocationDoc
} from '$lib/features/locations';

const TYPE_PREFIX_END = '￰';
const thCompare = (a: string, b: string) => a.localeCompare(b, 'th');

/** Read every doc whose `_id` starts with `{type}:` from the registry. */
async function allDocsByType<T>(type: string, guard: (d: unknown) => d is T): Promise<T[]> {
	const startkey = encodeURIComponent(JSON.stringify(`${type}:`));
	const endkey = encodeURIComponent(JSON.stringify(`${type}:${TYPE_PREFIX_END}`));
	const { status, data } = await adminRaw(
		`/${LOCATION_DB}/_all_docs?include_docs=true&startkey=${startkey}&endkey=${endkey}`,
		'GET'
	);
	if (status === 404) return []; // registry not provisioned yet
	if (status >= 400) throw new Error(`registry _all_docs failed (HTTP ${status})`);
	const rows = (data as { rows?: { doc?: unknown }[] })?.rows ?? [];
	return rows.map((r) => r.doc).filter((d): d is T => guard(d));
}

/** Mango `_find` on the registry, scoped to a single doc type. */
async function findByType<T>(
	type: string,
	selector: Record<string, unknown>,
	guard: (d: unknown) => d is T
): Promise<T[]> {
	const { status, data } = await adminRaw(`/${LOCATION_DB}/_find`, 'POST', {
		selector: { type, ...selector },
		limit: 100_000
	});
	if (status === 404) return [];
	if (status >= 400) throw new Error(`registry _find failed (HTTP ${status})`);
	const docs = (data as { docs?: unknown[] })?.docs ?? [];
	return docs.filter((d): d is T => guard(d));
}

export function listProvinces(): Promise<string[]> {
	return allDocsByType<ProvinceDoc>('location_province', isProvinceDoc).then((docs) =>
		docs.map((d) => d.name).sort(thCompare)
	);
}

export function listDistricts(province: string): Promise<string[]> {
	return findByType<DistrictDoc>(
		'location_district',
		{ province_id: provinceDocId(province) },
		isDistrictDoc
	).then((docs) => docs.map((d) => d.name).sort(thCompare));
}

export interface Subdistrict {
	subdistrict: string;
	zipcode: number;
}

export function listSubdistricts(province: string, district: string): Promise<Subdistrict[]> {
	return findByType<SubdistrictDoc>(
		'location_subdistrict',
		{ district_id: districtDocId(province, district) },
		isSubdistrictDoc
	).then((docs) =>
		docs
			.map((d) => ({ subdistrict: d.name, zipcode: d.zipcode }))
			.sort((a, b) => thCompare(a.subdistrict, b.subdistrict))
	);
}

export interface LocationRecord {
	province: string;
	district: string;
	subdistrict: string;
	zipcode: number;
}

/** Flat list of every subdistrict (province/district denormalized) — backs the
 * household form's combined search-select. */
export function listAllLocations(): Promise<LocationRecord[]> {
	return allDocsByType<SubdistrictDoc>('location_subdistrict', isSubdistrictDoc).then((docs) =>
		docs
			.map((d) => ({
				province: d.province,
				district: d.district,
				subdistrict: d.name,
				zipcode: d.zipcode
			}))
			.sort((a, b) => thCompare(a.subdistrict, b.subdistrict))
	);
}

// ── writes (SA-only; callers must requireAdmin first) ────────────────────────

/** PUT a brand-new doc; translate CouchDB 409 into a friendly "exists" error. */
async function createDoc(doc: LocationDoc, label: string): Promise<void> {
	const res = await adminRaw(`/${LOCATION_DB}/${encodeURIComponent(doc._id)}`, 'PUT', doc);
	if (res.status === 409) throw new ServiceError('CONFLICT', `${label} มีอยู่แล้ว`);
	if (res.status >= 400) throw new ServiceError('INTERNAL', `เขียน ${label} ไม่สำเร็จ`);
}

async function getRaw<T>(id: string): Promise<T | null> {
	const res = await adminRaw(`/${LOCATION_DB}/${encodeURIComponent(id)}`, 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) throw new ServiceError('INTERNAL', `อ่าน ${id} ไม่สำเร็จ`);
	return res.data as T;
}

/** True if any doc of `type` references `parentId` via `field`. */
async function hasChildren(type: string, field: string, parentId: string): Promise<boolean> {
	const { status, data } = await adminRaw(`/${LOCATION_DB}/_find`, 'POST', {
		selector: { type, [field]: parentId },
		limit: 1
	});
	if (status >= 400) throw new ServiceError('INTERNAL', 'ตรวจสอบข้อมูลลูกไม่สำเร็จ');
	return ((data as { docs?: unknown[] })?.docs ?? []).length > 0;
}

export async function createProvince(name: string, by: string): Promise<void> {
	const clean = name.trim();
	if (!clean) throw new ServiceError('VALIDATION', 'ต้องระบุชื่อจังหวัด');
	return createDoc(makeProvinceDoc(clean, by), `จังหวัด "${clean}"`);
}

export async function createDistrict(province: string, name: string, by: string): Promise<void> {
	const clean = name.trim();
	if (!province.trim() || !clean)
		throw new ServiceError('VALIDATION', 'ต้องระบุจังหวัดและชื่ออำเภอ');
	if (!(await getRaw<ProvinceDoc>(provinceDocId(province))))
		throw new ServiceError('CONFLICT', `ไม่พบจังหวัด "${province}"`);
	return createDoc(makeDistrictDoc(province, clean, by), `อำเภอ "${clean}"`);
}

export async function createSubdistrict(
	province: string,
	district: string,
	name: string,
	zipcode: number,
	by: string
): Promise<void> {
	const clean = name.trim();
	if (!province.trim() || !district.trim() || !clean)
		throw new ServiceError('VALIDATION', 'ต้องระบุจังหวัด อำเภอ และชื่อตำบล');
	if (!Number.isInteger(zipcode) || zipcode < 10000 || zipcode > 99999)
		throw new ServiceError('VALIDATION', 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก');
	if (!(await getRaw<DistrictDoc>(districtDocId(province, district))))
		throw new ServiceError('CONFLICT', `ไม่พบอำเภอ "${district}"`);
	return createDoc(makeSubdistrictDoc(province, district, clean, zipcode, by), `ตำบล "${clean}"`);
}

export async function updateSubdistrictZipcode(id: string, zipcode: number): Promise<void> {
	if (!id.startsWith(`${SUBDISTRICT_TYPE}:`))
		throw new ServiceError('VALIDATION', 'แก้ไขรหัสไปรษณีย์ได้เฉพาะระดับตำบล');
	if (!Number.isInteger(zipcode) || zipcode < 10000 || zipcode > 99999)
		throw new ServiceError('VALIDATION', 'รหัสไปรษณีย์ต้องเป็นเลข 5 หลัก');
	const doc = await getRaw<SubdistrictDoc>(id);
	if (!doc) throw new ServiceError('CONFLICT', 'ไม่พบตำบลที่ต้องการแก้ไข');
	const next = { ...doc, zipcode, updated_at: new Date().toISOString() };
	const res = await adminRaw(`/${LOCATION_DB}/${encodeURIComponent(id)}`, 'PUT', next);
	if (res.status === 409)
		throw new ServiceError('CONFLICT', 'ข้อมูลถูกแก้ไขโดยผู้อื่น — โหลดใหม่แล้วลองอีกครั้ง');
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'แก้ไขรหัสไปรษณีย์ไม่สำเร็จ');
}

/** Delete a location doc. Provinces/districts with descendants are rejected. */
export async function deleteLocation(id: string): Promise<void> {
	if (id.startsWith(`${PROVINCE_TYPE}:`)) {
		if (await hasChildren(DISTRICT_TYPE, 'province_id', id))
			throw new ServiceError('CONFLICT', 'ลบจังหวัดไม่ได้ — ยังมีอำเภออยู่ ให้ลบอำเภอก่อน');
	} else if (id.startsWith(`${DISTRICT_TYPE}:`)) {
		if (await hasChildren(SUBDISTRICT_TYPE, 'district_id', id))
			throw new ServiceError('CONFLICT', 'ลบอำเภอไม่ได้ — ยังมีตำบลอยู่ ให้ลบตำบลก่อน');
	} else if (!id.startsWith(`${SUBDISTRICT_TYPE}:`)) {
		throw new ServiceError('VALIDATION', 'ชนิดเอกสารไม่ถูกต้อง');
	}

	const doc = await getRaw<{ _id: string; _rev?: string }>(id);
	if (!doc?._rev) return; // already gone — idempotent
	const res = await adminRaw(
		`/${LOCATION_DB}/${encodeURIComponent(id)}?rev=${encodeURIComponent(doc._rev)}`,
		'DELETE'
	);
	if (res.status >= 400 && res.status !== 404)
		throw new ServiceError('INTERNAL', `ลบไม่สำเร็จ (HTTP ${res.status})`);
}

// re-export id helpers for the write route to build ids from body params
export { provinceDocId, districtDocId, subdistrictDocId };
