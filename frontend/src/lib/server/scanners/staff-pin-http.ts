import { json } from '@sveltejs/kit';
import { authorizeUserWrite, ServiceError, type Caller } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerDeviceNotFoundError
} from './device-credentials';
import { StaffPinNotSetError, StaffPinUnavailableError } from './staff-pin-store';

/** Every staff-PIN response may carry a PIN or lock state — never cache it. */
export const STAFF_PIN_NO_STORE = { 'cache-control': 'no-store', pragma: 'no-cache' } as const;

export function staffPinJson(body: unknown, status: number): Response {
	return json(body, { status, headers: STAFF_PIN_NO_STORE });
}

function errorBody(code: string, message: string) {
	return { error: { code, message } };
}

/** SA-only gate shared by the admin staff-PIN and device-delete routes (same as device create). */
export async function requireStaffPinAdmin(request: Request): Promise<Caller> {
	const caller = await authorizeUserWrite(request.headers.get('cookie'));
	if (!caller.isSA) throw new ServiceError('FORBIDDEN', 'Requires system_admin');
	return caller;
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
