import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	hashSecret,
	scannerServerRepository,
	smartCardDataSchema
} from '$lib/features/scanners/server';

export const prerender = false;

export const POST: RequestHandler = async ({ request }) => {
	try {
		const deviceIdHeader = request.headers.get('x-device-id');
		const deviceSecretHeader =
			request.headers.get('x-device-secret') ||
			request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');

		const body = await request.json().catch(() => ({}));

		const deviceId = deviceIdHeader || body.device_id;
		const secret = deviceSecretHeader || body.device_secret;

		if (!deviceId || !secret) {
			return json(
				{ error: 'Missing X-Device-Id or X-Device-Secret authentication header' },
				{ status: 401 }
			);
		}

		// Find device in catalog
		const device = await scannerServerRepository.getDeviceByDeviceId(deviceId);
		if (!device || device.status !== 'active') {
			return json({ error: 'Device not found or inactive' }, { status: 401 });
		}

		// Verify secret hash
		const hashed = await hashSecret(secret);
		if (hashed !== device.secret_hash) {
			return json({ error: 'Invalid device secret' }, { status: 401 });
		}

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
			device.shelter_code,
			device.device_id,
			device.station_name,
			cardData
		);

		// Update device heartbeat
		try {
			await scannerServerRepository.updateDeviceLastSeen(device._id);
		} catch (heartbeatErr) {
			console.warn('[Scanner Inbound] Heartbeat update warning:', heartbeatErr);
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
			shelter_code: device.shelter_code,
			citizen_id: cardData.citizen_id,
			created_at: scanResult.evacuee.created_at
		});
	} catch (err) {
		console.error('[Scanner Inbound] Error processing scan draft:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Internal Server Error' },
			{ status: 500 }
		);
	}
};
