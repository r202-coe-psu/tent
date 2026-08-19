/**
 * Public donation tracking via SvelteKit BFF.
 *
 * FastAPI `/public/v1/donations/{token}` requires EXTERNAL_API_SECRET — the browser
 * must not call it with publicClient. Same pattern as POST/PATCH in the donate wizard.
 */
import { toDonationTrackView, type DonationTrackView } from '../domain/tracking';

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
		throw new Error(unwrapError(body, 'บันทึกเลขพัสดุไม่สำเร็จ'));
	}
}

/**
 * Cancel a live reservation (T-21 DoD: donor cancels via token, no login).
 *
 * The BFF picks the write path — CouchDB doc, or FastAPI's Mongo intake buffer when
 * inbound has not synced yet — and releases the reserved quota on either side (CR-045).
 */
export async function cancelDonation(trackingToken: string): Promise<void> {
	const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(trackingToken)}`, {
		method: 'DELETE'
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		if (res.status === 429) throw new Error('คุณส่งคำขอบ่อยเกินไป กรุณารอสักครู่แล้วลองใหม่');
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
