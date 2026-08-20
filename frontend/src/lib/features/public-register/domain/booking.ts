/**
 * Public booking domain — CR-070 / T-71.
 *
 * The citizen-facing shape of a self-service shelter booking. Deliberately much
 * narrower than the staff `evacueeInputSchema`: only the T-48 minimum is asked
 * for at the gate-less web step (medical and identity documents are collected
 * by staff at the gate under T-49), and `phone` is mandatory because
 * D-BOOK-TOKEN=A makes it the second factor for self-lookup.
 *
 * Pure: no I/O, no Svelte, no CouchDB. Safe to import from `+server.ts`.
 */
import { z } from 'zod';
import { shelterCodeSchema } from '$lib/db/model';

/** Thai mobile number, digits only. Unlike staff intake, "ไม่มี" is not an option. */
export const bookingPhoneSchema = z
	.string({ error: 'กรุณากรอกเบอร์โทรศัพท์' })
	.trim()
	.regex(/^\d{10}$/, 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลัก');

export const publicBookingInputSchema = z.object({
	shelter_code: shelterCodeSchema,
	first_name: z.string({ error: 'กรุณากรอกชื่อ' }).trim().min(1, 'กรุณากรอกชื่อ').max(100),
	last_name: z.string({ error: 'กรุณากรอกนามสกุล' }).trim().min(1, 'กรุณากรอกนามสกุล').max(100),
	gender: z.enum(['male', 'female', 'other'], { error: 'กรุณาเลือกเพศ' }),
	phone: bookingPhoneSchema,
	captchaToken: z.string().trim().optional()
});

export type PublicBookingInput = z.infer<typeof publicBookingInputSchema>;

/**
 * Map a public booking onto the staff `EvacueeInput` shape.
 *
 * Everything the public form does not ask for is left to `evacueeInputSchema`'s
 * own defaults (country THAILAND, religion buddhist, empty special_needs, …) so
 * a web booking and a staff registration produce the same doc shape. The caller
 * hands the result to `createEvacuee`, which stamps `pre_registered`.
 */
export function toEvacueeInput(input: PublicBookingInput) {
	return {
		first_name: input.first_name,
		last_name: input.last_name,
		gender: input.gender,
		phone: input.phone,
		household_id: null,
		registered_via: 'web' as const
	};
}

/**
 * Booking reference printed on the ticket and embedded in the QR.
 *
 * D-BOOK-TOKEN=A allows "QR **or** `official_code` + phone"; `official_code`
 * (T-50) does not exist yet, so slice 1 uses the evacuee ULID — the same value
 * the staff QR already encodes, which means the gate scanner resolves a web
 * booking with no change (`lookupEvacueeByScanCode`). When T-50 lands, lookup
 * gains a second branch and must keep accepting ULIDs forever: tickets already
 * printed cannot be reissued.
 */
export function bookingCodeFrom(evacueeId: string): string {
	return evacueeId.startsWith('evacuee:') ? evacueeId.slice('evacuee:'.length) : evacueeId;
}

/** Inverse of {@link bookingCodeFrom} — accepts a bare ULID or a full doc id. */
export function evacueeIdFromBookingCode(code: string): string {
	const trimmed = code.trim().toUpperCase();
	return trimmed.startsWith('EVACUEE:')
		? `evacuee:${trimmed.slice('EVACUEE:'.length)}`
		: `evacuee:${trimmed}`;
}

export const publicBookingLookupSchema = z.object({
	code: z.string({ error: 'กรุณากรอกรหัสการจอง' }).trim().min(1, 'กรุณากรอกรหัสการจอง').max(64),
	phone: bookingPhoneSchema
});

export type PublicBookingLookupInput = z.infer<typeof publicBookingLookupSchema>;

/** Server error codes the wizard maps to Thai copy. */
export type PublicBookingErrorCode =
	| 'RATE_LIMITED'
	| 'CAPTCHA_REQUIRED'
	| 'CAPTCHA_FAILED'
	| 'SHELTER_NOT_FOUND'
	| 'SHELTER_CLOSED'
	| 'BOOKING_NOT_FOUND'
	| 'WRITE_FAILED';

const ERROR_COPY: Record<PublicBookingErrorCode, string> = {
	RATE_LIMITED: 'มีการส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่',
	CAPTCHA_REQUIRED: 'ไม่สามารถยืนยันว่าไม่ใช่บอทได้ กรุณารีเฟรชหน้าแล้วลองใหม่',
	CAPTCHA_FAILED: 'การยืนยันตัวตนไม่ผ่าน กรุณารีเฟรชหน้าแล้วลองใหม่',
	SHELTER_NOT_FOUND: 'ไม่พบศูนย์พักพิงที่เลือก กรุณาเลือกใหม่',
	SHELTER_CLOSED: 'ศูนย์พักพิงนี้ปิดรับผู้เข้าพักแล้ว กรุณาเลือกศูนย์อื่น',
	BOOKING_NOT_FOUND: 'ไม่พบการจองที่ตรงกับรหัสและเบอร์โทรนี้',
	WRITE_FAILED: 'บันทึกการจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง'
};

export function publicBookingErrorMessage(code: unknown): string {
	if (typeof code === 'string' && code in ERROR_COPY) {
		return ERROR_COPY[code as PublicBookingErrorCode];
	}
	return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}
