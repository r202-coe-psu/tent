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
import { cancelKioskSession } from '$lib/server/thaid-scan-session';

export const prerender = false;

/** Idempotent: always `{ ok: true }`; only the owning device's session is ever cancelled. */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const parsed = kioskThaidSessionRefSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return kioskThaidInvalidInputResponse();

		cancelKioskSession(parsed.data.session_id, principal.registry_id);
		return json({ ok: true }, { headers: kioskThaidNoStoreHeaders });
	} catch (error) {
		return kioskThaidErrorResponse(error);
	}
};
