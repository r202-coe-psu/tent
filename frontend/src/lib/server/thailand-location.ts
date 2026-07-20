/**
 * Thailand province/district/subdistrict lookup — backs the cascading address
 * selects on the shelter form and the combined search-select on the household
 * register form.
 *
 * HOTFIX: reads use the bundled static JSON snapshot. The CouchDB-backed location
 * editor is temporarily disabled while production persistence is investigated.
 * Keeping the existing API contract means shelter and household forms continue
 * to work without depending on `registry` location documents.
 *
 * Server-only: uses the CouchDB admin client. Never import from a client bundle.
 */

import rows from '../../../static/data/thailand_location_data.json';
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
	type ProvinceDoc,
	type DistrictDoc,
	type SubdistrictDoc,
	type LocationDoc,
	type LocationRow
} from '$lib/features/locations';

const DATA = rows as LocationRow[];
const thCompare = (a: string, b: string) => a.localeCompare(b, 'th');

export async function listProvinces(): Promise<string[]> {
	return [...new Set(DATA.map((row) => row.province))].sort(thCompare);
}

export async function listDistricts(province: string): Promise<string[]> {
	return [
		...new Set(DATA.filter((row) => row.province === province).map((row) => row.district))
	].sort(thCompare);
}

export interface Subdistrict {
	subdistrict: string;
	zipcode: number;
}

export async function listSubdistricts(province: string, district: string): Promise<Subdistrict[]> {
	return DATA.filter((row) => row.province === province && row.district === district)
		.map((row) => ({ subdistrict: row.subdistrict, zipcode: row.zipcode }))
		.sort((a, b) => thCompare(a.subdistrict, b.subdistrict));
}

export interface LocationRecord {
	province: string;
	district: string;
	subdistrict: string;
	zipcode: number;
}

/** Flat list backing the household form's combined search-select. */
export async function listAllLocations(): Promise<LocationRecord[]> {
	return DATA.map((row) => ({ ...row })).sort((a, b) => thCompare(a.subdistrict, b.subdistrict));
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
