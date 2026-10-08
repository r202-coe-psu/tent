import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';

/**
 * v2 adds staff bypass PIN *metadata* (set / default / who / when). The PIN itself never lives in
 * the registry — it is in the admin-only `scanner_secrets` DB, read server-side only. v1 docs still
 * parse and read as "no PIN set".
 */
export const SCANNER_SCHEMA_V = 2;
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

// ---------------------------------------------------------------- Staff PIN

export const STAFF_PIN_LENGTH = 6;

/** Any 6-digit PIN — what the kiosk sends and what reveal returns. */
export const staffPinSchema = z
	.string({ error: 'กรุณากรอก PIN' })
	.regex(/^\d{6}$/, 'PIN ต้องเป็นตัวเลข 6 หลัก');

/**
 * True for PINs a bystander would guess first: one repeated digit (`000000`) or a straight
 * ascending/descending run (`123456`, `654321`, `012345`, …). Rejected when SA picks a PIN and
 * never produced by the generator.
 */
export function isTrivialStaffPin(pin: string): boolean {
	if (!/^\d+$/.test(pin) || pin.length < 2) return false;
	const digits = [...pin].map(Number);
	const steps = digits.slice(1).map((d, i) => d - digits[i]);
	return steps.every((s) => s === 0) || steps.every((s) => s === 1) || steps.every((s) => s === -1);
}

/** A PIN chosen by SA: 6 digits and not trivially guessable. */
export const chosenStaffPinSchema = staffPinSchema.refine((pin) => !isTrivialStaffPin(pin), {
	message: 'PIN นี้เดาง่ายเกินไป (เช่น เลขซ้ำกันทั้งหมด หรือเรียงกันอย่าง 123456)'
});

/** Admin "ตั้ง PIN" form: PIN + confirmation. */
export const setStaffPinFormSchema = z
	.object({
		pin: chosenStaffPinSchema,
		confirm: z.string({ error: 'กรุณายืนยัน PIN' })
	})
	.refine((value) => value.pin === value.confirm, {
		message: 'PIN ทั้งสองช่องไม่ตรงกัน',
		path: ['confirm']
	});
export type SetStaffPinFormValues = z.infer<typeof setStaffPinFormSchema>;

/** Body of `POST /api/v1/scanner/devices/[id]/staff-pin`. */
export const staffPinUpdateRequestSchema = z.union([
	z.object({ pin: chosenStaffPinSchema }).strict(),
	z.object({ regenerate: z.literal(true) }).strict()
]);
export type StaffPinUpdateRequest = z.infer<typeof staffPinUpdateRequestSchema>;

export const staffPinUpdateResponseSchema = z
	.object({ ok: z.literal(true), pin: staffPinSchema.optional() })
	.strict();
export type StaffPinUpdateResponse = z.infer<typeof staffPinUpdateResponseSchema>;

/** Body of `POST /api/v1/scanner/devices/[id]/staff-pin/reveal` (SA only, no-store). */
export const staffPinRevealResponseSchema = z
	.object({
		pin: staffPinSchema,
		is_default: z.boolean(),
		updated_at: z.string().min(1).nullable(),
		updated_by: z.string().min(1).nullable()
	})
	.strict();
export type StaffPinReveal = z.infer<typeof staffPinRevealResponseSchema>;

// ---------------------------------------------------------------- Persisted device

const scannerDevicePersistedBaseShape = {
	_id: z.string().min(1),
	_rev: z.string().min(1).optional(),
	type: z.literal('scanner_device'),
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
};

/** v1 document (before staff PIN). Read as "no PIN"; upgraded to v2 when a PIN is first set. */
export const scannerDevicePersistedV1Schema = z
	.object({ ...scannerDevicePersistedBaseShape, schema_v: z.literal(1) })
	.strict();

export const scannerDevicePersistedV2Schema = z
	.object({
		...scannerDevicePersistedBaseShape,
		schema_v: z.literal(2),
		/** Whether a PIN exists in `scanner_secrets` — never the PIN itself. */
		staff_pin_set: z.boolean(),
		staff_pin_is_default: z.boolean(),
		staff_pin_updated_at: z.string().min(1).nullable(),
		staff_pin_updated_by: z.string().min(1).nullable()
	})
	.strict();

/** The persisted registry document (v1 or v2). Keep this type server-only in practice. */
export const scannerDevicePersistedSchema = z.discriminatedUnion('schema_v', [
	scannerDevicePersistedV1Schema,
	scannerDevicePersistedV2Schema
]);

export type PersistedScannerDeviceV1 = z.infer<typeof scannerDevicePersistedV1Schema>;
export type PersistedScannerDeviceV2 = z.infer<typeof scannerDevicePersistedV2Schema>;
export type PersistedScannerDevice = z.infer<typeof scannerDevicePersistedSchema>;

export interface ScannerStaffPinState {
	staff_pin_set: boolean;
	staff_pin_is_default: boolean;
	staff_pin_updated_at: string | null;
	staff_pin_updated_by: string | null;
}

/** Staff PIN fields of any doc version; a v1 doc has none. */
export function staffPinStateOf(doc: PersistedScannerDevice): ScannerStaffPinState {
	if (doc.schema_v === 1) {
		return {
			staff_pin_set: false,
			staff_pin_is_default: false,
			staff_pin_updated_at: null,
			staff_pin_updated_by: null
		};
	}
	return {
		staff_pin_set: doc.staff_pin_set,
		staff_pin_is_default: doc.staff_pin_set && doc.staff_pin_is_default,
		staff_pin_updated_at: doc.staff_pin_updated_at,
		staff_pin_updated_by: doc.staff_pin_updated_by
	};
}

/**
 * Safe browser/API representation. It intentionally has no hash, prefix, revision, timestamps,
 * or PIN material — only whether a PIN is set and whether it is still the generated default.
 */
export const scannerDeviceSummarySchema = z
	.object({
		id: z.string().min(1),
		device_id: scannerDeviceInputSchema.shape.device_id,
		name: scannerDeviceInputSchema.shape.name,
		shelter_code: shelterCodeSchema,
		station_name: scannerDeviceInputSchema.shape.station_name,
		status: deviceStatusSchema,
		last_seen_at: z.string().min(1).nullable(),
		staff_pin_set: z.boolean(),
		staff_pin_is_default: z.boolean()
	})
	.strict();

export type ScannerDeviceSummary = z.infer<typeof scannerDeviceSummarySchema>;
export type ScannerDevice = ScannerDeviceSummary;

/** Device details returned by bootstrap; it does not disclose the registry id or PIN state. */
export const scannerBootstrapDeviceSchema = scannerDeviceSummarySchema
	.omit({ id: true, staff_pin_set: true, staff_pin_is_default: true })
	.extend({ shelter_name: z.string().trim().min(1) });
export type ScannerBootstrapDevice = z.infer<typeof scannerBootstrapDeviceSchema>;

export const scannerCreateResponseSchema = z
	.object({
		device: scannerDeviceSummarySchema,
		plaintext_secret: z.string().min(1),
		/** Generated default PIN, shown once to the SA who created the device. */
		plaintext_staff_pin: staffPinSchema
	})
	.strict();

export type ScannerCreateResponse = z.infer<typeof scannerCreateResponseSchema>;

export function toScannerDeviceSummary(doc: PersistedScannerDevice): ScannerDeviceSummary {
	const pin = staffPinStateOf(doc);
	return {
		id: doc._id,
		device_id: doc.device_id,
		name: doc.name,
		shelter_code: doc.shelter_code,
		station_name: doc.station_name,
		status: doc.status,
		last_seen_at: doc.last_seen_at,
		staff_pin_set: pin.staff_pin_set,
		staff_pin_is_default: pin.staff_pin_is_default
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
	plaintext_staff_pin: string;
};

/** The summary alone: drops the one-time plaintext secret and default PIN of a just-created device. */
export function withoutScannerPlaintext(
	device: ScannerDeviceSummary | CreatedScannerDevice
): ScannerDeviceSummary {
	return {
		id: device.id,
		device_id: device.device_id,
		name: device.name,
		shelter_code: device.shelter_code,
		station_name: device.station_name,
		status: device.status,
		last_seen_at: device.last_seen_at,
		staff_pin_set: device.staff_pin_set,
		staff_pin_is_default: device.staff_pin_is_default
	};
}

// ---------------------------------------------------------------- Smart Card Data Schema

export const smartCardDataSchema = z.object({
	citizen_id: z
		.string()
		.trim()
		.regex(/^\d{13}$/, 'เลขบัตรประชาชนต้องเป็นตัวเลข 13 หลัก'),
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
	photo_base64: z.string().max(2_000_000).nullable().default(null),
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
