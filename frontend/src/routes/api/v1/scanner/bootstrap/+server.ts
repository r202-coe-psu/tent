import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { now } from '$lib/db/model';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError,
	toBootstrapDevice
} from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

function failedAuth(): Response {
	return json(
		{ error: { code: DEVICE_AUTH_FAILED, message: 'Device authentication failed' } },
		{ status: 401, headers: noStoreHeaders }
	);
}

function unavailable(): Response {
	return json(
		{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'Scanner credential service unavailable' } },
		{ status: 503, headers: noStoreHeaders }
	);
}

export const POST: RequestHandler = async ({ request }) => {
	const deviceId = request.headers.get('x-device-id') ?? '';
	const secret = request.headers.get('x-device-secret') ?? '';
	if (!deviceId || !secret) return failedAuth();

	try {
		await request.json().catch(() => ({}));
		const principal = await authenticateScannerDevice(deviceId, secret, scannerServerRepository);
		const shelter = await findMasterByCode(principal.shelter_code);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id);
		return json(
			{
				device: toBootstrapDevice(
					principal,
					'active',
					null,
					shelter?.name?.trim() || principal.shelter_code
				),
				server_time: now()
			},
			{ status: 200, headers: noStoreHeaders }
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) return failedAuth();
		if (error instanceof ScannerDependencyError) return unavailable();
		return unavailable();
	}
};
