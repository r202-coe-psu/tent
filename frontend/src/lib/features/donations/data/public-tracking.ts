/**
 * Public donation tracking via SvelteKit BFF.
 *
 * FastAPI `/public/v1/donations/{token}` requires EXTERNAL_API_SECRET — the browser
 * must not call it with publicClient. Same pattern as POST/PATCH in the donate wizard.
 */
import {
	toDonationTrackView,
	type DonationLookupItem,
	type DonationTrackView
} from '../domain/tracking';

export type DonationLookupErrorCode =
	'CAPTCHA_REQUIRED' | 'CAPTCHA_FAILED' | 'INVALID_PHONE' | 'RATE_LIMITED';

/**
 * A phone lookup the BFF refused, by code — the page words it in the donor's language.
 * `CAPTCHA_REQUIRED` came without a token (the caller gets one and asks again);
 * `CAPTCHA_FAILED` came with one that did not verify (CR-173 FR-8).
 */
export class DonationLookupError extends Error {
	constructor(readonly code: DonationLookupErrorCode) {
		super(code);
		this.name = 'DonationLookupError';
	}
}

/** The shelter has started taking this booking's goods into stock (BFF 409). */
const GOODS_IN_STOCK_MESSAGE =
	'ศูนย์เริ่มรับของของใบนี้เข้าคลังแล้ว — แก้ไขหรือยกเลิกไม่ได้ กรุณาติดต่อศูนย์';

function isGoodsInStock(body: unknown): boolean {
	return (body as { error?: unknown } | null)?.error === 'GOODS_IN_STOCK';
}

/** The BFF could not read the shelter's record, so nothing changed (BFF 503). */
const DONATION_UNAVAILABLE_MESSAGE = 'ตรวจสอบรายการบริจาคไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';

function isDonationUnavailable(body: unknown): boolean {
	return (body as { error?: unknown } | null)?.error === 'DONATION_UNAVAILABLE';
}

function unwrapError(body: unknown, fallback: string): string {
	if (typeof body !== 'object' || body === null) return fallback;
	const record = body as { error?: unknown; message?: unknown };
	if (typeof record.error === 'string') return record.error;
	if (typeof record.message === 'string') return record.message;
	return fallback;
}

export async function fetchDonationTracking(trackingToken: string): Promise<DonationTrackView> {
	const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(trackingToken)}`);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 404) throw new Error('ไม่พบรายการบริจาคสำหรับรหัสนี้');
		if (res.status === 429) throw new Error('คุณค้นหาบ่อยเกินไป กรุณารอสักครู่');
		throw new Error(unwrapError(body, 'ไม่สามารถโหลดสถานะบริจาคได้'));
	}
	const donation = (body as { donation?: Record<string, unknown> }).donation;
	if (!donation) throw new Error('ไม่พบรายการบริจาคสำหรับรหัสนี้');
	return toDonationTrackView(donation);
}

export async function searchDonationTracking(input: {
	bookingRef: string;
	phone: string;
}): Promise<{ trackingToken: string; bookingRef: string }> {
	const res = await fetch('/api/public/v1/donations/track-search', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			booking_ref: input.bookingRef.trim(),
			phone: input.phone.trim()
		})
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 404) {
			throw new Error('ไม่พบรายการบริจาค — ตรวจสอบรหัส DN และเบอร์โทรที่ใช้ตอนจอง');
		}
		if (res.status === 429) throw new Error('คุณค้นหาบ่อยเกินไป กรุณารอสักครู่');
		throw new Error(unwrapError(body, 'ไม่สามารถค้นหารายการบริจาคได้'));
	}
	const trackingToken = (body as { trackingToken?: string }).trackingToken;
	const bookingRef = (body as { bookingRef?: string }).bookingRef;
	if (!trackingToken) throw new Error('ไม่พบรายการบริจาคสำหรับรหัสนี้');
	return { trackingToken, bookingRef: bookingRef ?? input.bookingRef };
}

/**
 * Every booking of a phone number that is still in the system (CR-173). The phone goes in
 * the body — never the URL (FR-1). A number with no bookings resolves to `[]`.
 */
export async function lookupDonationsByPhone(input: {
	phone: string;
	captchaToken?: string;
}): Promise<DonationLookupItem[]> {
	const res = await fetch('/api/public/v1/donations/lookup-by-phone', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			phone: input.phone.trim(),
			...(input.captchaToken ? { captcha_token: input.captchaToken } : {})
		})
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		const error = (body as { error?: string }).error;
		if (error === 'CAPTCHA_REQUIRED' || error === 'CAPTCHA_FAILED') {
			throw new DonationLookupError(error);
		}
		if (res.status === 422) throw new DonationLookupError('INVALID_PHONE');
		if (res.status === 429) throw new DonationLookupError('RATE_LIMITED');
		throw new Error(unwrapError(body, 'ไม่สามารถค้นหารายการบริจาคได้'));
	}
	const items = (body as { items?: DonationLookupItem[] }).items;
	return Array.isArray(items) ? items : [];
}

export async function updateCourierTracking(
	trackingToken: string,
	courierTrackingNo: string
): Promise<void> {
	const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(trackingToken)}`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ courier_tracking_no: courierTrackingNo })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (isDonationUnavailable(body)) throw new Error(DONATION_UNAVAILABLE_MESSAGE);
		throw new Error(unwrapError(body, 'บันทึกเลขพัสดุไม่สำเร็จ'));
	}
}

export async function cancelDonation(trackingToken: string): Promise<void> {
	const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(trackingToken)}`, {
		method: 'DELETE'
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 429) throw new Error('คุณส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
		if (isGoodsInStock(body)) throw new Error(GOODS_IN_STOCK_MESSAGE);
		if (isDonationUnavailable(body)) throw new Error(DONATION_UNAVAILABLE_MESSAGE);
		if (res.status === 409) {
			throw new Error('รายการนี้กำลังบันทึกเข้าระบบ กรุณารีเฟรชแล้วลองใหม่อีกครั้ง');
		}
		if (res.status === 400) {
			throw new Error('รายการนี้ยกเลิกไม่ได้แล้ว — เจ้าหน้าที่เริ่มดำเนินการหรือปิดรายการไปแล้ว');
		}
		if (res.status === 404) throw new Error('ไม่พบรายการบริจาคสำหรับรหัสนี้');
		throw new Error(unwrapError(body, 'ยกเลิกการจองไม่สำเร็จ'));
	}
}

/** What the donor wants the booking to contain — the whole basket, not a delta. */
export type DonationItemEdit = {
	item_id?: string;
	free_text?: string;
	qty: string;
	unit: string;
};

export async function updateDonationItems(
	trackingToken: string,
	items: DonationItemEdit[]
): Promise<{ revisions: number }> {
	const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(trackingToken)}/items`, {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ items })
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 429) throw new Error('คุณส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
		if ((body as { error?: string }).error === 'NEED_FULL') {
			throw new Error(
				'มีผู้บริจาคท่านอื่นจองตัดหน้าพอดี — จำนวนที่ขอเกินยอดที่เหลืออยู่ กรุณาลดจำนวนแล้วลองใหม่'
			);
		}
		if (isGoodsInStock(body)) throw new Error(GOODS_IN_STOCK_MESSAGE);
		if (isDonationUnavailable(body)) throw new Error(DONATION_UNAVAILABLE_MESSAGE);
		if ((body as { error?: string }).error === 'BOOKING_CHANGED') {
			throw new Error('ศูนย์เพิ่งอัปเดตรายการนี้ระหว่างที่คุณแก้ไข กรุณารีเฟรชแล้วลองใหม่อีกครั้ง');
		}
		// Before the generic 400: the booking is still editable, this edit is not — it would
		// keep only lines the shelter already refused. Cancelling is the way out (CR-174).
		if ((body as { error?: string }).error === 'NO_ACCEPTED_ITEMS') {
			throw new Error(
				'ต้องเหลืออย่างน้อย 1 รายการที่ศูนย์ไม่ได้ปฏิเสธ — ถ้าไม่ต้องการบริจาคแล้ว ให้กด "ยกเลิกการจองนี้" แทน'
			);
		}
		if (res.status === 400) {
			throw new Error('รายการนี้แก้ไม่ได้แล้ว — เจ้าหน้าที่เริ่มตรวจรับหรือปิดรายการไปแล้ว');
		}
		if (res.status === 404) throw new Error('ไม่พบรายการบริจาคสำหรับรหัสนี้');
		throw new Error(unwrapError(body, 'แก้ไขรายการไม่สำเร็จ'));
	}
	return { revisions: (body as { revisions?: number }).revisions ?? 0 };
}
