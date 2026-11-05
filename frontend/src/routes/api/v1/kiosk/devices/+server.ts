import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { serviceError, ServiceError } from '$lib/server/couch-admin';
import {
	ScannerConflictError,
	ScannerDependencyError,
	ScannerShelterNotFoundError
} from '$lib/server/scanners/device-credentials';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import {
	assertCanCreateFor,
	requireDeviceViewer,
	requireScannerManager
} from '$lib/server/scanners/scanner-access';
import { staffPinAdminError, staffPinJson } from '$lib/server/scanners/staff-pin-http';
import { scopedShelterFilter } from '$lib/server/shelter-capability-access';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	scannerDeviceInputSchema,
	toScannerDeviceSummary
} from '$lib/features/kiosk-devices/domain/scanner.schema';

export const prerender = false;

function noStoreHeaders(): HeadersInit {
	return { 'cache-control': 'no-store', pragma: 'no-cache' };
}

function scannerError(error: unknown): Response | null {
	if (error instanceof ScannerConflictError) {
		return json(
			{ error: { code: 'CONFLICT', message: 'Device ID already exists' } },
			{ status: 409, headers: noStoreHeaders() }
		);
	}
	if (error instanceof ScannerShelterNotFoundError) {
		return json(
			{ error: { code: 'NOT_FOUND', message: 'Shelter not found' } },
			{ status: 404, headers: noStoreHeaders() }
		);
	}
	if (error instanceof ScannerDependencyError) {
		return json(
			{
				error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Scanner credential service unavailable' }
			},
			{ status: 503, headers: noStoreHeaders() }
		);
	}
	return null;
}

/**
 * List devices. A shelter manager / kiosk_staff / pr_staff lists one shelter at a time
 * (`?shelter_code=` is required, 400 otherwise; a shelter outside their scope is 403 like POST).
 * SA may omit it to list every shelter.
 */
export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await requireDeviceViewer(request);
		const requested = url.searchParams.get('shelter_code');
		if (!caller.isSA && !requested) {
			throw new ServiceError('VALIDATION', 'shelter_code is required');
		}
		const scope = scopedShelterFilter(caller, requested);
		if (scope?.length === 0) {
			throw new ServiceError(
				'FORBIDDEN',
				'Not a shelter_manager, kiosk_staff or pr_staff of this shelter'
			);
		}
		const devices = await scannerDeviceRepository.listDevices(scope);
		return staffPinJson(devices.map(toScannerDeviceSummary), 200);
	} catch (error) {
		return staffPinAdminError(error);
	}
};

export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await requireScannerManager(request);

		const body: unknown = await request.json().catch(() => ({}));
		const parsed = scannerDeviceInputSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError(
				'VALIDATION',
				parsed.error.issues[0]?.message ?? 'Invalid scanner device'
			);
		}

		assertCanCreateFor(caller, parsed.data.shelter_code);

		const created = await scannerDeviceRepository.createDevice(parsed.data, caller.name);
		console.info(
			`[scanner-device] created device=${created.device.device_id} shelter=${created.device.shelter_code} by=${caller.name} at=${new Date().toISOString()}`
		);
		return json(
			{
				device: toScannerDeviceSummary(created.device),
				plaintext_secret: created.plaintext_secret,
				plaintext_staff_pin: created.plaintext_staff_pin
			},
			{ status: 201, headers: noStoreHeaders() }
		);
	} catch (error) {
		const mapped = scannerError(error);
		if (mapped) return mapped;
		const response = serviceError(error);
		for (const [name, value] of Object.entries(noStoreHeaders())) response.headers.set(name, value);
		return response;
	}
};
