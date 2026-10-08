import {
	scannerCreateResponseSchema,
	staffPinRevealResponseSchema,
	staffPinUpdateResponseSchema,
	type ScannerCreateResponse,
	type ScannerDeviceInput,
	type StaffPinReveal,
	type StaffPinUpdateRequest,
	type StaffPinUpdateResponse
} from '../domain/scanner.schema';

function responseMessage(payload: unknown, fallback = 'ไม่สามารถลงทะเบียนเครื่องสแกนได้'): string {
	if (!payload || typeof payload !== 'object') return fallback;
	const body = payload as { error?: unknown };
	if (typeof body.error === 'string') return body.error;
	if (body.error && typeof body.error === 'object') {
		const message = (body.error as { message?: unknown }).message;
		if (typeof message === 'string') return message;
	}
	return fallback;
}

function errorCode(payload: unknown): string | null {
	const error = (payload as { error?: { code?: unknown } } | null)?.error;
	return error && typeof error === 'object' && typeof error.code === 'string' ? error.code : null;
}

export async function createScannerDevice(
	input: ScannerDeviceInput
): Promise<ScannerCreateResponse> {
	const response = await fetch('/api/v1/scanner/devices', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error(responseMessage(payload));
	return scannerCreateResponseSchema.parse(payload);
}

/** Delete a device (SA only). Server-side so its staff PIN is removed with it. */
export async function deleteScannerDevice(id: string): Promise<void> {
	const response = await fetch(`/api/v1/scanner/devices/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		cache: 'no-store'
	});
	if (response.ok) return;
	const payload: unknown = await response.json().catch(() => null);
	if (response.status === 401) throw new Error('กรุณาเข้าสู่ระบบใหม่');
	if (response.status === 403) throw new Error('เฉพาะผู้ดูแลระบบ (SA) เท่านั้นที่ลบเครื่องสแกนได้');
	if (response.status === 404) throw new Error('ไม่พบเครื่องสแกนนี้');
	if (response.status === 409) throw new Error('มีการแก้ไขเครื่องนี้พร้อมกัน กรุณาลองใหม่อีกครั้ง');
	throw new Error(responseMessage(payload, 'ไม่สามารถลบเครื่องสแกนได้'));
}

// ---------------------------------------------------------------- Staff PIN (SA only)

/** Thai, PIN-free message for a failed staff-PIN admin call. */
function staffPinErrorMessage(status: number, payload: unknown, fallback: string): string {
	if (status === 400 || status === 422) return responseMessage(payload, 'PIN ไม่ถูกต้อง');
	if (status === 401) return 'กรุณาเข้าสู่ระบบใหม่';
	if (status === 403) return 'เฉพาะผู้ดูแลระบบ (SA) เท่านั้นที่จัดการ PIN ได้';
	if (status === 404) return 'ไม่พบเครื่องสแกนนี้';
	if (status === 409 && errorCode(payload) === 'staff_pin_not_set') {
		return 'เครื่องนี้ยังไม่ได้ตั้ง PIN';
	}
	if (status === 409) return 'มีการแก้ไขเครื่องนี้พร้อมกัน กรุณาลองใหม่อีกครั้ง';
	if (status === 503) return 'ระบบ PIN ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง';
	return fallback;
}

function staffPinPath(id: string, suffix = ''): string {
	return `/api/v1/scanner/devices/${encodeURIComponent(id)}/staff-pin${suffix}`;
}

/** Set a chosen PIN (`{ pin }`) or regenerate one (`{ regenerate: true }` → returns `pin`). */
export async function setScannerStaffPin(
	id: string,
	input: StaffPinUpdateRequest
): Promise<StaffPinUpdateResponse> {
	const response = await fetch(staffPinPath(id), {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input),
		cache: 'no-store'
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(staffPinErrorMessage(response.status, payload, 'ไม่สามารถตั้ง PIN ได้'));
	}
	return staffPinUpdateResponseSchema.parse(payload);
}

/** Reveal a device's PIN. POST + no-store so the PIN never lands in an HTTP cache. */
export async function revealScannerStaffPin(id: string): Promise<StaffPinReveal> {
	const response = await fetch(staffPinPath(id, '/reveal'), { method: 'POST', cache: 'no-store' });
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(staffPinErrorMessage(response.status, payload, 'ไม่สามารถเปิดดู PIN ได้'));
	}
	return staffPinRevealResponseSchema.parse(payload);
}
