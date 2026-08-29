import { z } from 'zod';
import {
	type BaseDoc,
	type CatalogDoc,
	type Timestamp,
	makeDoc,
	shelterCodeSchema
} from '$lib/db/model';
import { CATALOG_DB } from '$lib/features/catalog/data/catalog.remote';

export const SCANNER_SCHEMA_V = 1;
export const SCANNER_CATALOG_DB = CATALOG_DB;

// ---------------------------------------------------------------- Device Schema

export const deviceStatusSchema = z.enum(['active', 'inactive']);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const scannerDeviceInputSchema = z.object({
	device_id: z
		.string({ error: 'กรุณาระบุ Device ID' })
		.trim()
		.min(2, 'Device ID ต้องมีอย่างน้อย 2 ตัวอักษร')
		.regex(/^[A-Za-z0-9_-]+$/, 'Device ID ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข _ และ -'),
	name: z.string({ error: 'กรุณาระบุชื่อเครื่องสแกน' }).trim().min(1, 'กรุณาระบุชื่อเครื่องสแกน'),
	shelter_code: shelterCodeSchema,
	station_name: z.string().trim().default('จุดคัดกรองทั่วไป'),
	status: deviceStatusSchema.default('active')
});
export type ScannerDeviceInput = z.infer<typeof scannerDeviceInputSchema>;

export interface ScannerDevice extends CatalogDoc {
	type: 'scanner_device';
	device_id: string;
	name: string;
	shelter_code: string;
	station_name: string;
	secret?: string;
	secret_hash: string;
	secret_prefix: string;
	status: DeviceStatus;
	last_seen_at: Timestamp | null;
}

export interface CreatedScannerDevice extends ScannerDevice {
	plaintext_secret: string;
}

// ---------------------------------------------------------------- Draft Scan Schema

export const draftStatusSchema = z.enum(['pending', 'claimed', 'expired']);
export type DraftStatus = z.infer<typeof draftStatusSchema>;

export const smartCardDataSchema = z.object({
	citizen_id: z.string().trim().length(13, 'เลขบัตรประชาชนต้องมี 13 หลัก'),
	title_th: z.string().trim().default(''),
	first_name_th: z.string().trim().default(''),
	last_name_th: z.string().trim().default(''),
	full_name_th: z.string().trim().default(''),
	title_en: z.string().trim().default(''),
	first_name_en: z.string().trim().default(''),
	last_name_en: z.string().trim().default(''),
	full_name_en: z.string().trim().default(''),
	birth_date: z.string().trim().default(''),
	birth_year_ce: z.number().nullable().default(null),
	age: z.number().nullable().default(null),
	gender: z.enum(['male', 'female', 'other']).default('other'),
	address_raw: z.string().trim().default(''),
	address_no: z.string().trim().nullable().default(null),
	village_no: z.string().trim().nullable().default(null),
	lane: z.string().trim().nullable().default(null),
	road: z.string().trim().nullable().default(null),
	subdistrict: z.string().trim().nullable().default(null),
	district: z.string().trim().nullable().default(null),
	province: z.string().trim().nullable().default(null),
	photo_base64: z.string().nullable().default(null),
	issuer: z.string().trim().nullable().default(null),
	issue_date: z.string().trim().nullable().default(null),
	expire_date: z.string().trim().nullable().default(null)
});
export type SmartCardData = z.infer<typeof smartCardDataSchema>;

export interface ScannerDraft extends BaseDoc {
	type: 'scanner_draft';
	device_id: string;
	station_name: string;
	status: DraftStatus;
	card_data: SmartCardData;
	expires_at: Timestamp;
	claimed_at: Timestamp | null;
	claimed_by: string | null;
}

// ---------------------------------------------------------------- Helpers & Factories

export function isScannerDevice(doc: unknown): doc is ScannerDevice {
	if (!doc || typeof doc !== 'object') return false;
	const d = doc as Record<string, unknown>;
	return (
		d.type === 'scanner_device' && typeof d.device_id === 'string' && typeof d.name === 'string'
	);
}

export function isScannerDraft(doc: unknown): doc is ScannerDraft {
	if (!doc || typeof doc !== 'object') return false;
	const d = doc as Record<string, unknown>;
	return (
		d.type === 'scanner_draft' && typeof d.device_id === 'string' && typeof d.card_data === 'object'
	);
}

/** Calculate CE birth year and age from Thai Smart Card birth date string YYYYMMDD (พ.ศ.) */
export function parseThaiSmartCardDate(rawDateStr: string): {
	birth_year_ce: number | null;
	age: number | null;
	formatted_date: string;
} {
	if (!rawDateStr || rawDateStr.length < 8) {
		return { birth_year_ce: null, age: null, formatted_date: rawDateStr || '' };
	}

	const beYear = parseInt(rawDateStr.slice(0, 4), 10);
	const month = parseInt(rawDateStr.slice(4, 6), 10);
	const day = parseInt(rawDateStr.slice(6, 8), 10);

	if (isNaN(beYear) || beYear < 2400) {
		return { birth_year_ce: null, age: null, formatted_date: rawDateStr };
	}

	const ceYear = beYear - 543;
	const currentYear = new Date().getFullYear();
	const age = Math.max(0, currentYear - ceYear);
	const formatted_date = `${day.toString().padStart(2, '0')}/${month.toString().padStart(2, '0')}/${beYear}`;

	return { birth_year_ce: ceYear, age, formatted_date };
}

/** Factory to create a new ScannerDraft record in Shelter DB */
export function createScannerDraftDoc(
	shelterCode: string,
	deviceId: string,
	stationName: string,
	cardData: SmartCardData,
	expiryHours: number = 24
): ScannerDraft {
	const expires = new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString();

	return makeDoc(
		'scanner_draft',
		SCANNER_SCHEMA_V,
		{
			device_id: deviceId,
			station_name: stationName,
			status: 'pending' as DraftStatus,
			card_data: cardData,
			expires_at: expires,
			claimed_at: null,
			claimed_by: null
		},
		{
			shelterCode,
			createdBy: `device:${deviceId}`
		}
	);
}
