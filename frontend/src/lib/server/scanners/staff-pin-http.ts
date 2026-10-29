import { json } from '@sveltejs/kit';
import {
	scannerServerRepository,
	type PersistedScannerDevice
} from '$lib/features/kiosk-devices/server';
import { ServiceError } from '$lib/server/couch-admin';
import {
	authenticateScannerDevice,
	DEPENDENCY_UNAVAILABLE,
	DEVICE_AUTH_FAILED,
	ScannerAuthError,
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError
} from './device-credentials';
import { verifyDeviceStaffPin } from './staff-pin';
import { StaffPinNotSetError, StaffPinUnavailableError } from './staff-pin-store';
import { staffPinThrottle, type StaffPinThrottleResult } from './staff-pin-throttle';

/** Every staff-PIN response may carry a PIN or its set/verify state — never cache it. */
export const STAFF_PIN_NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

export function staffPinJson(body: unknown, status: number): Response {
	return json(body, { status, headers: STAFF_PIN_NO_STORE });
}

function errorBody(code: string, message: string) {
	return { error: { code, message } };
}

const DEVICE_ID_PARAM = /^[A-Za-z0-9_-]{2,}$/;

/**
 * Registry doc id for the `[id]` path param, which is the `device_id` (`kiosk-01`), not the doc
 * `_id` (`scanner_device:kiosk-01`). Anything that is not a valid device id is a missing device.
 */
export function scannerDocIdFromParam(deviceId: string): string {
	if (!DEVICE_ID_PARAM.test(deviceId)) throw new ScannerDeviceNotFoundError();
	return `scanner_device:${deviceId}`;
}

const SERVICE_STATUS: Record<string, number> = {
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	VALIDATION: 400,
	CONFLICT: 409,
	INTERNAL: 500
};

/** Map admin staff-PIN / device-delete failures to the contract envelope, always `no-store`. */
export function staffPinAdminError(error: unknown): Response {
	if (error instanceof ServiceError) {
		return staffPinJson(errorBody(error.code, error.message), SERVICE_STATUS[error.code] ?? 500);
	}
	if (error instanceof ScannerDeviceNotFoundError) {
		return staffPinJson(errorBody('NOT_FOUND', 'Scanner device not found'), 404);
	}
	if (error instanceof StaffPinNotSetError) {
		return staffPinJson(
			errorBody('staff_pin_not_set', 'Staff PIN is not set for this device'),
			409
		);
	}
	if (error instanceof ScannerConflictError) {
		return staffPinJson(errorBody('CONFLICT', 'Scanner device was modified concurrently'), 409);
	}
	if (error instanceof StaffPinUnavailableError) {
		return staffPinJson(errorBody('STAFF_PIN_UNAVAILABLE', 'Staff PIN store unavailable'), 503);
	}
	if (error instanceof ScannerDependencyError) {
		return staffPinJson(
			errorBody('DEPENDENCY_UNAVAILABLE', 'Scanner credential service unavailable'),
			503
		);
	}
	return staffPinJson(errorBody('INTERNAL', 'Unexpected server error'), 500);
}

/** The `pin` field of the body, whatever its shape; a malformed one is checked as a wrong PIN. */
function suppliedPin(body: unknown): unknown {
	return body && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined;
}

const PIN_CHECK_UNAVAILABLE = errorBody(DEPENDENCY_UNAVAILABLE, 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน');

/**
 * A kiosk request carrying the staff PIN of *this* device (CR-158): authenticate the scanner's
 * device credentials, then check the body's `pin` in the device's `staffPinThrottle` queue — so
 * every route asking for the PIN shares one guessing budget and the same errors. `onOk` answers
 * only once the PIN matched. `audit` gets one outcome per check and must never be given the PIN.
 */
export async function withDeviceStaffPin(
	request: Request,
	audit: (deviceId: string, outcome: string) => void,
	onOk: (device: PersistedScannerDevice) => Promise<Response>
): Promise<Response> {
	let device: PersistedScannerDevice | null = null;
	try {
		await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			{
				// Capture the doc authentication already loaded, so the PIN check needs no 2nd read.
				getDeviceByDeviceId: async (deviceId) => {
					device = await scannerServerRepository.getDeviceByDeviceId(deviceId);
					return device;
				}
			}
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return staffPinJson(errorBody(DEVICE_AUTH_FAILED, 'ไม่สามารถยืนยันเครื่อง kiosk ได้'), 401);
		}
		return staffPinJson(PIN_CHECK_UNAVAILABLE, 503);
	}
	const authenticated = device as PersistedScannerDevice | null;
	if (!authenticated) return staffPinJson(PIN_CHECK_UNAVAILABLE, 503);

	const pin = suppliedPin(await request.json().catch(() => null));

	let result: StaffPinThrottleResult;
	try {
		result = await staffPinThrottle.run(authenticated.device_id, async () => {
			const checked = await verifyDeviceStaffPin(authenticated, pin);
			audit(authenticated.device_id, checked.kind);
			return checked;
		});
	} catch (error) {
		audit(
			authenticated.device_id,
			error instanceof StaffPinUnavailableError ? 'unavailable' : 'error'
		);
		return staffPinJson(PIN_CHECK_UNAVAILABLE, 503);
	}
	switch (result.kind) {
		case 'busy':
			audit(authenticated.device_id, 'busy');
			return staffPinJson(errorBody('RATE_LIMITED', 'กำลังตรวจ PIN อยู่ กรุณารอสักครู่'), 429);
		case 'wrong':
			return staffPinJson(errorBody('staff_pin_invalid', 'PIN ไม่ถูกต้อง'), 401);
		case 'not_set':
			return staffPinJson(
				errorBody('staff_pin_not_set', 'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'),
				409
			);
		case 'ok':
			return onOk(authenticated);
	}
}
