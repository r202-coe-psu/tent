import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	isKioskThaidCheckInAllowed,
	kioskThaidErrorResponse,
	kioskThaidNoStoreHeaders
} from '$lib/features/kiosk/server';
import { kioskThaidSessionDeviceLimiter } from '$lib/server/security/rate-limiter';
import { createKioskCheckInSession } from '$lib/server/thaid-scan-session';
import { authenticateScannerDevice } from '$lib/server/scanners/device-credentials';

export const prerender = false;

export const POST: RequestHandler = async ({ request, url }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		if (!(await isKioskThaidCheckInAllowed(principal.shelter_code))) {
			return json(
				{
					error: {
						code: 'KIOSK_METHOD_DISABLED',
						message: 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่'
					}
				},
				{ status: 403, headers: kioskThaidNoStoreHeaders }
			);
		}
		if (!kioskThaidSessionDeviceLimiter.check(principal.registry_id)) {
			return json(
				{ error: { code: 'KIOSK_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' } },
				{ status: 429, headers: { ...kioskThaidNoStoreHeaders, 'retry-after': '60' } }
			);
		}
		const session = createKioskCheckInSession({
			device_id: principal.registry_id,
			shelter_code: principal.shelter_code
		});
		return json(
			{
				session_id: session.id,
				qr_url: `${url.origin}/api/v1/auth/oauth/thaid/start?mode=kiosk_check_in&session_id=${session.id}`,
				expires_at: session.expiresAt
			},
			{ headers: kioskThaidNoStoreHeaders }
		);
	} catch (error) {
		return kioskThaidErrorResponse(error);
	}
};
