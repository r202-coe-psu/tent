import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashSecret, scannerRepository, smartCardDataSchema } from '$lib/features/scanners';
import { now } from '$lib/db/model';

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
		const device = await scannerRepository.getDeviceByDeviceId(deviceId);
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

		// Save draft in shelter DB
		const draft = await scannerRepository.saveDraft(
			device.shelter_code,
			device.device_id,
			device.station_name,
			cardData
		);

		// Update device heartbeat
		try {
			await scannerRepository.updateDevice(device._id, { last_seen_at: now() });
		} catch (heartbeatErr) {
			console.warn('[Scanner Inbound] Heartbeat update warning:', heartbeatErr);
		}

		return json({
			ok: true,
			draft_id: draft._id,
			shelter_code: device.shelter_code,
			citizen_id: draft.card_data.citizen_id,
			created_at: draft.created_at
		});
	} catch (err) {
		console.error('[Scanner Inbound] Error processing scan draft:', err);
		return json(
			{ error: err instanceof Error ? err.message : 'Internal Server Error' },
			{ status: 500 }
		);
	}
};
