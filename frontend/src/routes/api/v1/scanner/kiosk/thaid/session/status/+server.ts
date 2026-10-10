import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	kioskThaidErrorResponse,
	kioskThaidInvalidInputResponse,
	kioskThaidNoStoreHeaders,
	kioskThaidSessionRefSchema
} from '$lib/features/kiosk/server';
import { authenticateScannerDevice } from '$lib/server/scanners/device-credentials';
import { getKioskSessionForDevice } from '$lib/server/thaid-scan-session';

export const prerender = false;

/**
 * Polling fallback for the kiosk QR screen. Returns the session state only (FR-KTD-12) — never
 * the citizen — and answers 404 for missing, expired and other-device sessions alike (FR-KTD-11).
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const parsed = kioskThaidSessionRefSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return kioskThaidInvalidInputResponse();

		const session = getKioskSessionForDevice(parsed.data.session_id, principal.registry_id);
		if (!session) {
			return json({ status: 'expired' }, { status: 404, headers: kioskThaidNoStoreHeaders });
		}
		return json(
			{
				status: session.status,
				expires_at: session.expiresAt,
				expires_in_sec: Math.max(0, Math.ceil((session.expiresAt - Date.now()) / 1000))
			},
			{ headers: kioskThaidNoStoreHeaders }
		);
	} catch (error) {
		return kioskThaidErrorResponse(error);
	}
};
