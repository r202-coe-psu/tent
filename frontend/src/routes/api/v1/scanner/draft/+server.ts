import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository, smartCardDataSchema } from '$lib/features/scanners/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const deviceId = request.headers.get('x-device-id') ?? '';
		const secret = request.headers.get('x-device-secret') ?? '';

		if (!deviceId || !secret) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'Device authentication failed' } },
				{ status: 401, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
			);
		}

		const principal = await authenticateScannerDevice(deviceId, secret, scannerServerRepository);

		const body = await request.json().catch(() => ({}));

		// Validate card data
		const parsed = smartCardDataSchema.safeParse(body.card_data || body);
		if (!parsed.success) {
			return json(
				{ error: 'Invalid card payload', details: parsed.error.format() },
				{ status: 400 }
			);
		}

		const cardData = parsed.data;

		// Process card scan in shelter DB (unified evacuee draft & pre-registered handler)
		const scanResult = await scannerServerRepository.processCardScan(
			principal.shelter_code,
			principal.device_id,
			principal.station_name,
			cardData
		);

		// Update device heartbeat
		try {
			await scannerServerRepository.updateDeviceLastSeen(principal.registry_id);
		} catch {
			console.warn('[Scanner Inbound] Heartbeat update warning');
		}

		if (scanResult.status !== 'created_pre_registered') {
			return json(
				{
					ok: false,
					status: scanResult.status,
					error: scanResult.error,
					message: scanResult.message,
					evacuee_id: scanResult.evacuee._id,
					citizen_id: cardData.citizen_id
				},
				{ status: 409 }
			);
		}

		return json({
			ok: true,
			status: scanResult.status,
			message: scanResult.message,
			evacuee_id: scanResult.evacuee._id,
			shelter_code: principal.shelter_code,
			citizen_id: cardData.citizen_id,
			created_at: scanResult.evacuee.created_at
		});
	} catch (err) {
		if (err instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'Device authentication failed' } },
				{ status: 401, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
			);
		}
		if (err instanceof ScannerDependencyError) {
			return json(
				{
					error: { code: DEPENDENCY_UNAVAILABLE, message: 'Scanner credential service unavailable' }
				},
				{ status: 503, headers: { 'cache-control': 'no-store', pragma: 'no-cache' } }
			);
		}
		console.error('[Scanner Inbound] Error processing scan draft');
		return json({ error: 'Internal Server Error' }, { status: 500 });
	}
};
