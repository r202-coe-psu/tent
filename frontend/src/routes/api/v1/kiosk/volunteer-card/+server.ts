import { json } from '@sveltejs/kit';
import { z } from 'zod';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	KioskLookupUnavailableError,
	KioskVolunteerCardNotFoundError,
	normalizeKioskPhone,
	resolveKioskVolunteerCard
} from '$lib/features/kiosk/server';
import { isKioskPhoneCheckInEnabled } from '$lib/features/kiosk/config';
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

const inputSchema = z.object({ phone: z.string() }).strict();

function errorResponse(
	status: number,
	code: string,
	message: string,
	headers: Record<string, string> = {}
): Response {
	return json({ error: { code, message } }, { status, headers: { ...noStoreHeaders, ...headers } });
}

/**
 * Show a volunteer their existing role-card QR after they type their phone at the kiosk.
 * Read-only: nothing is minted, rotated or written except the device last-seen stamp.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const parsed = inputSchema.safeParse(await request.json().catch(() => null));
		const canonical = parsed.success ? normalizeKioskPhone(parsed.data.phone) : null;
		if (!canonical) {
			return errorResponse(400, 'INVALID_VOLUNTEER_CARD_INPUT', 'ข้อมูลเบอร์โทรไม่ถูกต้อง');
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

		const volunteer = await resolveKioskVolunteerCard(principal.shelter_code, canonical);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		return json({ shelter_code: principal.shelter_code, volunteer }, { headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof KioskVolunteerCardNotFoundError) {
			return errorResponse(
				404,
				'KIOSK_VOLUNTEER_CARD_NOT_FOUND',
				'ไม่พบข้อมูลจิตอาสาที่ใช้เบอร์นี้ในศูนย์นี้ กรุณาติดต่อเจ้าหน้าที่'
			);
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
		return errorResponse(
			500,
			'KIOSK_VOLUNTEER_CARD_FAILED',
			'แสดงบัตรจิตอาสาไม่สำเร็จ กรุณาลองอีกครั้ง'
		);
	}
};
