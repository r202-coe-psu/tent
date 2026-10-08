import type { RequestHandler } from './$types';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	requireStaffPinAdmin,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

/**
 * Delete a scanner device (SA only). Server-side so the device's staff PIN is removed from the
 * admin-only `scanner_secrets` DB together with the registry doc.
 */
export const DELETE: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireStaffPinAdmin(request);
		await scannerDeviceRepository.deleteDevice(params.id);
		console.info(
			`[scanner-device] deleted device=${params.id} by=${caller.name} at=${new Date().toISOString()}`
		);
		return staffPinJson({ ok: true }, 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};
