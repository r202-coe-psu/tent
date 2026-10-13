import { json } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError
} from './device-credentials';
import { StaffPinNotSetError, StaffPinUnavailableError } from './staff-pin-store';

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
