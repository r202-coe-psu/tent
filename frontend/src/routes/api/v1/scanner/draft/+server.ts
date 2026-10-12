import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	ScannerAuthError,
	ScannerDependencyError,
	DEPENDENCY_UNAVAILABLE
} from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** Legacy card-draft endpoint. Kiosk check-in must never create registrations. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		return json(
			{
				error: {
					code: 'KIOSK_DRAFT_DISABLED',
					message: 'Use the kiosk pre-registration check-in flow'
				}
			},
			{ status: 410, headers: noStoreHeaders }
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'Device authentication failed' } },
				{ status: 401, headers: noStoreHeaders }
			);
		}
		if (error instanceof ScannerDependencyError) {
			return json(
				{
					error: { code: DEPENDENCY_UNAVAILABLE, message: 'Scanner credential service unavailable' }
				},
				{ status: 503, headers: noStoreHeaders }
			);
		}
		return json(
			{ error: { code: 'SCANNER_UNAVAILABLE', message: 'Scanner service unavailable' } },
			{ status: 503, headers: noStoreHeaders }
		);
	}
};
