import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { isKioskPhoneCheckInEnabled } from '$lib/features/kiosk/config';
import { findMasterByCode } from '$lib/server/shelters.admin';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';

export const prerender = false;

const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const shelter = await findMasterByCode(principal.shelter_code);
		return json(
			{
				shelter_code: principal.shelter_code,
				phone_check_in_enabled: isKioskPhoneCheckInEnabled(shelter)
			},
			{ status: 200, headers: noStoreHeaders }
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				{ status: 401, headers: noStoreHeaders }
			);
		}
		return json(
			{
				error: {
					code: DEPENDENCY_UNAVAILABLE,
					message: 'บริการตรวจสอบเครื่อง kiosk ไม่พร้อมใช้งาน'
				}
			},
			{ status: 503, headers: noStoreHeaders }
		);
	}
};
