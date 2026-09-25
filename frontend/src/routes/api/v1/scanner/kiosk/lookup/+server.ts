import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	lookupPreRegisteredEvacuee,
	kioskGateInputSchema,
	KioskInputError,
	normalizeKioskPhone
} from '$lib/features/kiosk/server';
import { isKioskPhoneCheckInEnabled } from '$lib/features/kiosk';
import {
	kioskPhoneDeviceLimiter,
	kioskPhoneNumberLimiter
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
		if (parsed.data.source === 'phone') {
			let shelter;
			try {
				shelter = await findMasterByCode(principal.shelter_code);
			} catch {
				throw new ScannerDependencyError('Shelter configuration service unavailable');
			}
			if (!isKioskPhoneCheckInEnabled(shelter)) {
				return json(
					{
						error: {
							code: 'KIOSK_METHOD_DISABLED',
							message: 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่'
						}
					},
					{ status: 403, headers: noStoreHeaders }
				);
			}
			const canonical = normalizeKioskPhone(parsed.data.phone);
			if (!canonical) {
				return json(
					{ error: { code: 'INVALID_GATE_INPUT', message: 'ข้อมูลสำหรับค้นหาไม่ถูกต้อง' } },
					{ status: 400, headers: noStoreHeaders }
				);
			}
			const deviceAllowed = kioskPhoneDeviceLimiter.check(principal.registry_id);
			if (!deviceAllowed) {
				return json(
					{ error: { code: 'KIOSK_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' } },
					{
						status: 429,
						headers: { ...noStoreHeaders, 'retry-after': '60' }
					}
				);
			}
			if (!parsed.data.primary_evacuee_id) {
				const phoneAllowed = kioskPhoneNumberLimiter.check(canonical);
				if (!phoneAllowed) {
					return json(
						{ error: { code: 'KIOSK_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' } },
						{
							status: 429,
							headers: { ...noStoreHeaders, 'retry-after': '60' }
						}
					);
				}
			}
		}
		const result = await lookupPreRegisteredEvacuee(principal.shelter_code, parsed.data);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		if (result.kind === 'not_found') {
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
		if (result.kind === 'too_many') {
			return json(
				{
					error: {
						code: 'KIOSK_TOO_MANY_MATCHES',
						message: 'พบหลายรายการ กรุณาติดต่อเจ้าหน้าที่'
					}
				},
				{ status: 409, headers: noStoreHeaders }
			);
		}
		return json(result, { headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof KioskInputError) {
			return json(
				{ error: { code: 'INVALID_GATE_INPUT', message: 'ข้อมูลสำหรับค้นหาไม่ถูกต้อง' } },
				{ status: 400, headers: noStoreHeaders }
			);
		}
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
