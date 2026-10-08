import type { RequestHandler } from './$types';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	requireStaffPinAdmin,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

/**
 * Reveal a scanner's staff bypass PIN to SA. POST (not GET) so it never lands in a browser
 * cache/history; every reveal is logged (who, which device, when) — never the PIN itself.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireStaffPinAdmin(request);
		const revealed = await scannerDeviceRepository.revealStaffPin(params.id);
		console.info(
			`[scanner-staff-pin] revealed device=${params.id} by=${caller.name} at=${new Date().toISOString()}`
		);
		return staffPinJson(revealed, 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};
