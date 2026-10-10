import { json } from '@sveltejs/kit';
import { z } from 'zod';
import {
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

export const kioskThaidNoStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

/** Body of the kiosk ThaiD `status` / `cancel` endpoints: the 32-hex session id from `session`. */
export const kioskThaidSessionRefSchema = z.object({
	session_id: z.string().regex(/^[0-9a-f]{32}$/)
});

export function kioskThaidInvalidInputResponse(): Response {
	return json(
		{ error: { code: 'INVALID_INPUT', message: 'ข้อมูลไม่ถูกต้อง' } },
		{ status: 400, headers: kioskThaidNoStoreHeaders }
	);
}

/** Shared device-auth / dependency error mapping for the kiosk ThaiD session endpoints. */
export function kioskThaidErrorResponse(error: unknown): Response {
	if (error instanceof ScannerAuthError) {
		return json(
			{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
			{ status: 401, headers: kioskThaidNoStoreHeaders }
		);
	}
	return json(
		{
			error: {
				code: DEPENDENCY_UNAVAILABLE,
				message:
					error instanceof ScannerDependencyError
						? 'บริการตรวจสอบเครื่อง kiosk ไม่พร้อมใช้งาน'
						: 'บริการไม่พร้อมใช้งาน กรุณาลองอีกครั้ง'
			}
		},
		{ status: 503, headers: kioskThaidNoStoreHeaders }
	);
}
