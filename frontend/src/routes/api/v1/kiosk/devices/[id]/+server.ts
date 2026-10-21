import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	scannerDevicePatchSchema,
	toScannerDeviceSummary
} from '$lib/features/kiosk-devices/domain/scanner.schema';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { assertDeviceInScope, requireScannerManager } from '$lib/server/scanners/scanner-access';
import {
	scannerDocIdFromParam,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

/**
 * Delete a scanner device (SA, or the shelter_manager of its shelter). Server-side so the device's
 * staff PIN is removed from the admin-only `scanner_secrets` DB together with the registry doc.
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const docId = scannerDocIdFromParam(params.id);
		const device = await scannerDeviceRepository.getDevice(docId);
		assertDeviceInScope(caller, device);
		await scannerDeviceRepository.deleteDevice(docId);
		console.info(
			`[scanner-device] deleted device=${params.id} shelter=${device.shelter_code} by=${caller.name} at=${new Date().toISOString()}`
		);
		return staffPinJson({ ok: true }, 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};

/**
 * Change a device's name, station or status (SA, or the shelter_manager of its shelter). Server
 * side because `registry` is SA-write-only for browsers. The body is validated before the device
 * is read, so an invalid body is 400 even for a device outside the caller's scope.
 */
export const PATCH: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const docId = scannerDocIdFromParam(params.id);

		const body: unknown = await request.json().catch(() => null);
		const parsed = scannerDevicePatchSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError(
				'VALIDATION',
				parsed.error.issues[0]?.message ?? 'Invalid scanner device update'
			);
		}

		const device = await scannerDeviceRepository.getDevice(docId);
		assertDeviceInScope(caller, device);
		const updated = await scannerDeviceRepository.updateDevice(docId, parsed.data, caller.name);
		return staffPinJson(toScannerDeviceSummary(updated), 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};
