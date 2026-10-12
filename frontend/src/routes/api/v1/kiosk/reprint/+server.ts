import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	KioskInputError,
	KioskLookupUnavailableError,
	KioskReprintNotFoundError,
	KioskReprintUnverifiableError,
	KioskReprintVerifyFailedError,
	kioskReprintInputSchema,
	normalizeKioskPhone,
	reprintKioskLabels
} from '$lib/features/kiosk/server';
import { isKioskPhoneCheckInEnabled } from '$lib/features/kiosk/config';
import {
	kioskReprintDeviceLimiter,
	kioskReprintVerifyFailureLimiter
} from '$lib/server/security/rate-limiter';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

function errorResponse(
	status: number,
	code: string,
	message: string,
	headers: Record<string, string> = {}
): Response {
	return json({ error: { code, message } }, { status, headers: { ...noStoreHeaders, ...headers } });
}

const rateLimited = () =>
	errorResponse(429, 'KIOSK_RATE_LIMITED', 'กรุณารอสักครู่แล้วลองใหม่', { 'retry-after': '60' });

/**
 * Reprint the QR labels of the phone owner's household after the visitor types the last four
 * digits of the owner's citizen id. Read-only; the phone lookup lists who can be reprinted.
 */
export const POST: RequestHandler = async ({ request }) => {
	let verifyKey: string | null = null;
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const parsed = kioskReprintInputSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success || !normalizeKioskPhone(parsed.data.phone)) {
			return errorResponse(400, 'INVALID_REPRINT_INPUT', 'ข้อมูลสำหรับพิมพ์ซ้ำไม่ถูกต้อง');
		}

		let shelter;
		try {
			shelter = await findMasterByCode(principal.shelter_code);
		} catch {
			throw new ScannerDependencyError('Shelter configuration service unavailable');
		}
		if (!isKioskPhoneCheckInEnabled(shelter)) {
			return errorResponse(
				403,
				'KIOSK_METHOD_DISABLED',
				'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่'
			);
		}
		if (!kioskReprintDeviceLimiter.check(principal.registry_id)) return rateLimited();
		// Only failed verifications spend this budget (recorded below), keyed by the primary so a
		// guesser cannot walk the 10 000 possible codes across devices.
		verifyKey = parsed.data.primary_evacuee_id.toUpperCase();
		if (kioskReprintVerifyFailureLimiter.isBlocked(verifyKey)) return rateLimited();

		const members = await reprintKioskLabels(principal.shelter_code, parsed.data);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		return json({ shelter_code: principal.shelter_code, members }, { headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof KioskReprintVerifyFailedError) {
			if (verifyKey) kioskReprintVerifyFailureLimiter.check(verifyKey);
			return errorResponse(403, 'KIOSK_REPRINT_VERIFY_FAILED', 'เลข 4 หลักท้ายไม่ถูกต้อง');
		}
		if (error instanceof KioskReprintUnverifiableError) {
			return errorResponse(
				403,
				'KIOSK_REPRINT_UNVERIFIABLE',
				'ไม่สามารถยืนยันตัวตนได้ กรุณาติดต่อเจ้าหน้าที่'
			);
		}
		if (error instanceof KioskReprintNotFoundError) {
			return errorResponse(404, 'KIOSK_REPRINT_NOT_FOUND', 'ไม่พบรายการสำหรับพิมพ์ซ้ำ');
		}
		if (error instanceof KioskInputError) {
			return errorResponse(400, 'INVALID_REPRINT_INPUT', 'ข้อมูลสำหรับพิมพ์ซ้ำไม่ถูกต้อง');
		}
		if (error instanceof KioskLookupUnavailableError) {
			return errorResponse(503, DEPENDENCY_UNAVAILABLE, 'บริการค้นหาข้อมูลไม่พร้อมใช้งาน');
		}
		if (error instanceof ScannerAuthError) {
			return errorResponse(401, DEVICE_AUTH_FAILED, 'ไม่สามารถยืนยันเครื่อง kiosk ได้');
		}
		if (error instanceof ScannerDependencyError) {
			return errorResponse(
				503,
				DEPENDENCY_UNAVAILABLE,
				'บริการตรวจสอบเครื่อง kiosk ไม่พร้อมใช้งาน'
			);
		}
		return errorResponse(500, 'KIOSK_REPRINT_FAILED', 'พิมพ์ซ้ำไม่สำเร็จ กรุณาลองอีกครั้ง');
	}
};
