import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	lookupPreRegisteredEvacuee,
	kioskGateInputSchema
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
		const parsed = kioskGateInputSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) {
			return json(
				{ error: { code: 'INVALID_GATE_INPUT', message: 'ข้อมูลสำหรับค้นหาไม่ถูกต้อง' } },
				{ status: 400, headers: noStoreHeaders }
			);
		}
		const result = await lookupPreRegisteredEvacuee(principal.shelter_code, parsed.data);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		if (!result) {
			return json(
				{
					error: {
						code: 'PRE_REGISTRATION_NOT_FOUND',
						message: 'ไม่พบผู้ลงทะเบียนล่วงหน้าในศูนย์นี้'
					}
				},
				{ status: 404, headers: noStoreHeaders }
			);
		}
		return json(result, { headers: noStoreHeaders });
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
			{ error: { code: 'KIOSK_LOOKUP_FAILED', message: 'ค้นหาข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง' } },
			{ status: 500, headers: noStoreHeaders }
		);
	}
};
