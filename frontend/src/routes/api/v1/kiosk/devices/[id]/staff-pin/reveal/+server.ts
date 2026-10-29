import type { RequestHandler } from './$types';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { assertDeviceInScope, requireDeviceViewer } from '$lib/server/scanners/scanner-access';
import {
	scannerDocIdFromParam,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

/**
 * Reveal a scanner's staff bypass PIN to SA, or a shelter_manager / kiosk_staff / pr_staff of its shelter. POST (not GET)
 * so it never lands in a browser cache/history; every reveal is logged (who, which device, when) — never the PIN itself.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireDeviceViewer(request);
		const docId = scannerDocIdFromParam(params.id);
		const device = await scannerDeviceRepository.getDevice(docId);
		assertDeviceInScope(caller, device);
		const revealed = await scannerDeviceRepository.revealStaffPin(docId);
		console.info(
			`[scanner-staff-pin] revealed device=${params.id} shelter=${device.shelter_code} by=${caller.name} at=${new Date().toISOString()}`
		);
		return staffPinJson(revealed, 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};
