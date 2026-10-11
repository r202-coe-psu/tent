import type { RequestHandler } from './$types';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { assertDeviceInScope, requireScannerManager } from '$lib/server/scanners/scanner-access';
import {
	scannerDocIdFromParam,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

/**
 * Delete a scanner device (SA, or the shelter_manager of its shelter). Server-side so the device's staff PIN is removed from the
 * admin-only `scanner_secrets` DB together with the registry doc.
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
