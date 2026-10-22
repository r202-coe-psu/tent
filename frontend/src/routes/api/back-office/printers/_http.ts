/** Error envelope + domain-error mapping shared by the back-office printer routes (plan §4.3). */
import { json } from '@sveltejs/kit';
import { ServiceError } from '$lib/server/couch-admin';
import { PrintDependencyError } from '$lib/server/printers/device-credentials';
import { PrinterNotFoundError, PrinterOfflineError } from '$lib/server/printers/print-jobs.server';
import {
	PrintDeviceConflictError,
	PrintDeviceNotFoundError
} from '$lib/server/printers/printer-admin.server';
import { callerCanManage, type ScopedCaller } from '$lib/server/shelter-capability-access';

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export function noStoreJson(body: unknown, status = 200): Response {
	return json(body, { status, headers: noStoreHeaders });
}

export function noContent(): Response {
	return new Response(null, { status: 204, headers: noStoreHeaders });
}

function envelope(status: number, code: string, message: string): Response {
	return noStoreJson({ error: { code, message } }, status);
}

const SERVICE_STATUS: Record<ServiceError['code'], number> = {
	UNAUTHENTICATED: 401,
	FORBIDDEN: 403,
	VALIDATION: 422,
	CONFLICT: 409,
	INTERNAL: 500
};

const DEVICE_ID_PARAM = /^[a-z0-9][a-z0-9-]{2,62}$/;

/** Registry doc id for the `[id]` path param (the `device_id`); anything else is a missing printer. */
export function printerDocId(deviceId: string): string {
	if (!DEVICE_ID_PARAM.test(deviceId)) throw new PrintDeviceNotFoundError();
	return `print_device:${deviceId}`;
}

/** A printer outside the caller's scope reads as missing, like kiosk devices (FR-SBO-04). */
export function assertPrinterInScope<T extends { shelter_code: string }>(
	caller: ScopedCaller,
	device: T | null
): T {
	if (!device || !callerCanManage(caller, [device.shelter_code])) {
		throw new PrintDeviceNotFoundError();
	}
	return device;
}

export function printerAdminError(e: unknown): Response {
	if (e instanceof ServiceError) return envelope(SERVICE_STATUS[e.code], e.code, e.message);
	if (e instanceof PrinterOfflineError) return envelope(409, 'PRINTER_OFFLINE', e.message);
	if (e instanceof PrinterNotFoundError) return envelope(404, 'NOT_FOUND', e.message);
	if (e instanceof PrintDeviceNotFoundError) return envelope(404, 'NOT_FOUND', e.message);
	if (e instanceof PrintDeviceConflictError) return envelope(409, 'CONFLICT', e.message);
	if (e instanceof PrintDependencyError) return envelope(503, 'DEPENDENCY_UNAVAILABLE', e.message);
	return envelope(500, 'INTERNAL', 'Unexpected server error');
}
