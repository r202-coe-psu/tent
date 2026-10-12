import {
	scannerCreateResponseSchema,
	scannerDeviceListResponseSchema,
	scannerDeviceSummarySchema,
	staffPinRevealResponseSchema,
	staffPinUpdateResponseSchema,
	type ScannerCreateResponse,
	type ScannerDevice,
	type ScannerDeviceInput,
	type ScannerDevicePatch,
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
	const response = await fetch('/api/v1/kiosk/devices', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(input)
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error(responseMessage(payload));
	return scannerCreateResponseSchema.parse(payload);
}

/**
 * List devices through the server. SA may omit `shelterCode` (all shelters); everyone else must
 * pass one the server will accept (400 / 403 otherwise).
 */
export async function listScannerDevices(shelterCode?: string): Promise<ScannerDevice[]> {
	const query = shelterCode ? `?shelter_code=${encodeURIComponent(shelterCode)}` : '';
	const response = await fetch(`/api/v1/kiosk/devices${query}`, { cache: 'no-store' });
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error(responseMessage(payload, 'ไม่สามารถโหลดรายการเครื่องสแกนได้'));
	return scannerDeviceListResponseSchema.parse(payload);
}

/** Patch name / station / status of a device by `device_id` (not the registry doc `_id`). */
export async function updateScannerDevice(
	deviceId: string,
	patch: ScannerDevicePatch
): Promise<ScannerDevice> {
	const response = await fetch(`/api/v1/kiosk/devices/${encodeURIComponent(deviceId)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(patch)
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) throw new Error(responseMessage(payload, 'ไม่สามารถแก้ไขเครื่องสแกนได้'));
	return scannerDeviceSummarySchema.parse(payload);
}

/** Delete a device by `device_id`. Server-side so its staff PIN is removed with it. */
export async function deleteScannerDevice(deviceId: string): Promise<void> {
	const response = await fetch(`/api/v1/kiosk/devices/${encodeURIComponent(deviceId)}`, {
		method: 'DELETE',
		cache: 'no-store'
	});
	if (response.ok) return;
	const payload: unknown = await response.json().catch(() => null);
	if (response.status === 401) throw new Error('กรุณาเข้าสู่ระบบใหม่');
	if (response.status === 403) throw new Error('ไม่มีสิทธิ์ลบเครื่องสแกนของศูนย์นี้');
	if (response.status === 404) throw new Error('ไม่พบเครื่องสแกนนี้');
	if (response.status === 409) throw new Error('มีการแก้ไขเครื่องนี้พร้อมกัน กรุณาลองใหม่อีกครั้ง');
	throw new Error(responseMessage(payload, 'ไม่สามารถลบเครื่องสแกนได้'));
}

// ---------------------------------------------------------------- Staff PIN

/** Thai, PIN-free message for a failed staff-PIN admin call. */
function staffPinErrorMessage(status: number, payload: unknown, fallback: string): string {
	if (status === 400 || status === 422) return responseMessage(payload, 'PIN ไม่ถูกต้อง');
	if (status === 401) return 'กรุณาเข้าสู่ระบบใหม่';
	if (status === 403) return 'ไม่มีสิทธิ์จัดการ PIN ของเครื่องนี้';
	if (status === 404) return 'ไม่พบเครื่องสแกนนี้';
	if (status === 409 && errorCode(payload) === 'staff_pin_not_set') {
		return 'เครื่องนี้ยังไม่ได้ตั้ง PIN';
	}
	if (status === 409) return 'มีการแก้ไขเครื่องนี้พร้อมกัน กรุณาลองใหม่อีกครั้ง';
	if (status === 503) return 'ระบบ PIN ไม่พร้อมใช้งานชั่วคราว กรุณาลองใหม่อีกครั้ง';
	return fallback;
}

/** `[id]` in the path is the `device_id` (`kiosk-01`), not the registry doc `_id`. */
function staffPinPath(deviceId: string, suffix = ''): string {
	return `/api/v1/kiosk/devices/${encodeURIComponent(deviceId)}/staff-pin${suffix}`;
}

/** Set a chosen PIN (`{ pin }`) or regenerate one (`{ regenerate: true }` → returns `pin`). */
export async function setScannerStaffPin(
	deviceId: string,
	input: StaffPinUpdateRequest
): Promise<StaffPinUpdateResponse> {
	const response = await fetch(staffPinPath(deviceId), {
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
export async function revealScannerStaffPin(deviceId: string): Promise<StaffPinReveal> {
	const response = await fetch(staffPinPath(deviceId, '/reveal'), {
		method: 'POST',
		cache: 'no-store'
	});
	const payload: unknown = await response.json().catch(() => null);
	if (!response.ok) {
		throw new Error(staffPinErrorMessage(response.status, payload, 'ไม่สามารถเปิดดู PIN ได้'));
	}
	return staffPinRevealResponseSchema.parse(payload);
}
