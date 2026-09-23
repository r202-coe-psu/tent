import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	checkInSelectedMembers,
	kioskCheckInInputSchema
} from '$lib/features/kiosk/server/kiosk-check-in.server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
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
		const parsed = kioskCheckInInputSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return json(
				{ error: { code: 'INVALID_CHECK_IN_INPUT', message: 'รายชื่อผู้เข้าพักไม่ถูกต้อง' } },
				{ status: 400, headers: noStoreHeaders }
			);
		}
		const result = await checkInSelectedMembers(
			principal.shelter_code,
			parsed.data.primary_evacuee_id,
			parsed.data.evacuee_ids
		);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		return json(
			{ shelter_code: principal.shelter_code, members: result },
			{ headers: noStoreHeaders }
		);
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				{ status: 401, headers: noStoreHeaders }
			);
		}
		if (error instanceof ScannerDependencyError) {
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
		return json(
			{
				error: {
					code: 'KIOSK_CHECK_IN_FAILED',
					message: 'บันทึกการรายงานตัวไม่สำเร็จ กรุณาลองอีกครั้ง'
				}
			},
			{ status: 500, headers: noStoreHeaders }
		);
	}
};
