import type { RequestHandler } from './$types';
import { ServiceError } from '$lib/server/couch-admin';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { assertDeviceInScope, requireScannerManager } from '$lib/server/scanners/scanner-access';
import {
	scannerDocIdFromParam,
	staffPinAdminError,
	staffPinJson
} from '$lib/server/scanners/staff-pin-http';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import { staffPinUpdateRequestSchema } from '$lib/features/scanners/domain/scanner.schema';

export const prerender = false;

/**
 * Set (`{ pin }`) or regenerate (`{ regenerate: true }`) a scanner's staff bypass PIN. SA, or the
 * shelter_manager of the device's shelter.
 * The PIN is stored in the admin-only `scanner_secrets` DB; only a regenerate returns the new PIN,
 * to the caller who asked.
 */
export const POST: RequestHandler = async ({ request, params }) => {
	try {
		const caller = await requireScannerManager(request);
		const docId = scannerDocIdFromParam(params.id);
		const device = await scannerDeviceRepository.getDevice(docId);
		assertDeviceInScope(caller, device);

		const body: unknown = await request.json().catch(() => null);
		const parsed = staffPinUpdateRequestSchema.safeParse(body);
		if (!parsed.success) {
			const pinIssue = parsed.error.issues.find((issue) => issue.path[0] === 'pin');
			throw new ServiceError('VALIDATION', pinIssue?.message ?? 'PIN ต้องเป็นตัวเลข 6 หลัก');
		}

		if ('regenerate' in parsed.data) {
			const pin = await scannerDeviceRepository.regenerateStaffPin(docId, caller.name);
			console.info(
				`[scanner-staff-pin] regenerated device=${params.id} shelter=${device.shelter_code} by=${caller.name} at=${new Date().toISOString()}`
			);
			return staffPinJson({ ok: true, pin }, 200);
		}

		await scannerDeviceRepository.setStaffPin(docId, parsed.data.pin, caller.name);
		console.info(
			`[scanner-staff-pin] set device=${params.id} shelter=${device.shelter_code} by=${caller.name} at=${new Date().toISOString()}`
		);
		return staffPinJson({ ok: true }, 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};
