import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';

export const SCANNER_SCHEMA_V = 1;
export const SCANNER_REGISTRY_DB = 'registry';
export const SCANNER_CATALOG_DB = SCANNER_REGISTRY_DB;
export const SCANNER_DEVICE_DB = SCANNER_REGISTRY_DB;

// ---------------------------------------------------------------- Device Schema

export const deviceStatusSchema = z.enum(['active', 'inactive']);
export type DeviceStatus = z.infer<typeof deviceStatusSchema>;

export const scannerDeviceInputSchema = z
	.object({
		device_id: z
			.string({ error: 'กรุณาระบุ Device ID' })
			.trim()
			.min(2, 'Device ID ต้องมีอย่างน้อย 2 ตัวอักษร')
			.regex(/^[A-Za-z0-9_-]+$/, 'Device ID ใช้ได้เฉพาะตัวอักษรภาษาอังกฤษ ตัวเลข _ และ -'),
		name: z.string({ error: 'กรุณาระบุชื่อเครื่องสแกน' }).trim().min(1, 'กรุณาระบุชื่อเครื่องสแกน'),
		shelter_code: shelterCodeSchema,
		station_name: z.string().trim().min(1, 'กรุณาระบุจุดบริการ').default('จุดคัดกรองทั่วไป'),
		status: deviceStatusSchema.default('active')
	})
	.strict();
export type ScannerDeviceInput = z.infer<typeof scannerDeviceInputSchema>;

/** The persisted registry document. Keep this type server-only in practice. */
export const scannerDevicePersistedSchema = z
	.object({
		_id: z.string().min(1),
		_rev: z.string().min(1).optional(),
		type: z.literal('scanner_device'),
		schema_v: z.literal(SCANNER_SCHEMA_V),
		created_at: z.string().min(1),
		updated_at: z.string().min(1),
		created_by: z.string().min(1),
		device_id: scannerDeviceInputSchema.shape.device_id,
		name: scannerDeviceInputSchema.shape.name,
		shelter_code: shelterCodeSchema,
		station_name: scannerDeviceInputSchema.shape.station_name,
		secret_hash: z.string().regex(/^[0-9a-f]{64}$/, 'Invalid scanner secret hash'),
		secret_prefix: z.string().regex(/^sk_scan_[0-9a-f]{8}\.\.\.$/, 'Invalid scanner secret prefix'),
		status: deviceStatusSchema,
		last_seen_at: z.string().min(1).nullable()
	})
	.strict();

export type PersistedScannerDevice = z.infer<typeof scannerDevicePersistedSchema>;

/** Safe browser/API representation. It intentionally has no hash, prefix, revision, or timestamps. */
export const scannerDeviceSummarySchema = z
	.object({
		id: z.string().min(1),
		device_id: scannerDeviceInputSchema.shape.device_id,
		name: scannerDeviceInputSchema.shape.name,
		shelter_code: shelterCodeSchema,
		station_name: scannerDeviceInputSchema.shape.station_name,
		status: deviceStatusSchema,
		last_seen_at: z.string().min(1).nullable()
	})
	.strict();

export type ScannerDeviceSummary = z.infer<typeof scannerDeviceSummarySchema>;
export type ScannerDevice = ScannerDeviceSummary;

/** Device details returned by bootstrap; it does not disclose the registry document id. */
export const scannerBootstrapDeviceSchema = scannerDeviceSummarySchema
	.omit({ id: true })
	.extend({ shelter_name: z.string().trim().min(1) });
export type ScannerBootstrapDevice = z.infer<typeof scannerBootstrapDeviceSchema>;

export const scannerCreateResponseSchema = z
	.object({
		device: scannerDeviceSummarySchema,
		plaintext_secret: z.string().min(1)
	})
	.strict();

export type ScannerCreateResponse = z.infer<typeof scannerCreateResponseSchema>;

export function toScannerDeviceSummary(doc: PersistedScannerDevice): ScannerDeviceSummary {
	return {
		id: doc._id,
		device_id: doc.device_id,
		name: doc.name,
		shelter_code: doc.shelter_code,
		station_name: doc.station_name,
		status: doc.status,
		last_seen_at: doc.last_seen_at
	};
}

export function toScannerBootstrapDevice(doc: PersistedScannerDevice): ScannerBootstrapDevice {
	const summary = toScannerDeviceSummary(doc);
	return {
		device_id: summary.device_id,
		name: summary.name,
		shelter_code: summary.shelter_code,
		shelter_name: summary.shelter_code,
		station_name: summary.station_name,
		status: summary.status,
		last_seen_at: summary.last_seen_at
	};
}

export type CreatedScannerDevice = ScannerDeviceSummary & {
	plaintext_secret: string;
};

// ---------------------------------------------------------------- Smart Card Data Schema

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
	postal_code: z.string().trim().nullable().optional().default(null),
	photo_base64: z.string().nullable().default(null),
	issuer: z.string().trim().nullable().default(null),
	issue_date: z.string().trim().nullable().default(null),
	expire_date: z.string().trim().nullable().default(null)
});
export type SmartCardData = z.infer<typeof smartCardDataSchema>;

// ---------------------------------------------------------------- Helpers

export function isPersistedScannerDevice(doc: unknown): doc is PersistedScannerDevice {
	return scannerDevicePersistedSchema.safeParse(doc).success;
}

/** Backwards-compatible server-side guard; never use it for browser payloads. */
export const isScannerDevice = isPersistedScannerDevice;

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
