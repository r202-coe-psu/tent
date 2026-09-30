import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { ServiceError } from '$lib/server/couch-admin';
import { isKioskWalkInRegistrationEnabled } from '$lib/features/kiosk/config';
import {
	KioskRegistrationBlockedError,
	KioskPhotoValidationError,
	decodeKioskPhoto,
	kioskWalkInRegistrationInputSchema,
	registerKioskWalkIn
} from '$lib/features/kiosk/server/kiosk-register.server';
import { kioskRegisterDeviceLimiter } from '$lib/server/security/rate-limiter';
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
		if (!kioskRegisterDeviceLimiter.check(principal.registry_id)) {
			return json(
				{ error: { code: 'KIOSK_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' } },
				{ status: 429, headers: { ...noStoreHeaders, 'retry-after': '60' } }
			);
		}
		const body = await request.json().catch(() => null);
		const parsed = kioskWalkInRegistrationInputSchema.safeParse(body);
		if (!parsed.success) {
			return json(
				{
					error: {
						code: 'INVALID_KIOSK_REGISTRATION',
						message: 'ข้อมูลบัตรหรือการยินยอมไม่ถูกต้อง'
					}
				},
				{ status: 400, headers: noStoreHeaders }
			);
		}
		if (parsed.data.photo) {
			try {
				decodeKioskPhoto(parsed.data.photo);
			} catch (error) {
				if (error instanceof KioskPhotoValidationError) {
					return json(
						{
							error: {
								code: 'INVALID_KIOSK_REGISTRATION',
								message: 'ข้อมูลรูปจากบัตรไม่ถูกต้อง'
							}
						},
						{ status: 400, headers: noStoreHeaders }
					);
				}
				throw error;
			}
		}
		const shelter = await findMasterByCode(principal.shelter_code);
		if (!isKioskWalkInRegistrationEnabled(shelter)) {
			return json(
				{
					error: { code: 'KIOSK_REGISTRATION_DISABLED', message: 'ช่องทางลงทะเบียนที่ตู้ปิดใช้งาน' }
				},
				{ status: 403, headers: noStoreHeaders }
			);
		}
		const evacuee = await registerKioskWalkIn(
			principal.shelter_code,
			principal.device_id,
			principal.station_name,
			parsed.data.card,
			parsed.data.photo,
			parsed.data.consented_at
		);
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		return json({ status: 'created', evacuee_id: evacuee._id }, { headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return json(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				{ status: 401, headers: noStoreHeaders }
			);
		}
		if (error instanceof ScannerDependencyError) {
			return json(
				{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการ kiosk ไม่พร้อมใช้งาน' } },
				{ status: 503, headers: noStoreHeaders }
			);
		}
		if (error instanceof ServiceError) {
			return json(
				{
					error: {
						code: DEPENDENCY_UNAVAILABLE,
						message: 'ไม่สามารถตรวจสอบข้อมูลศูนย์พักพิงได้ กรุณาลองใหม่'
					}
				},
				{ status: 503, headers: noStoreHeaders }
			);
		}
		if (error instanceof KioskRegistrationBlockedError) {
			return json(
				{
					error: {
						code: 'KIOSK_REGISTRATION_BLOCKED',
						message: 'พบข้อมูลเดิม กรุณาไปพบเจ้าหน้าที่'
					}
				},
				{ status: 409, headers: noStoreHeaders }
			);
		}
		if (error instanceof KioskPhotoValidationError) {
			return json(
				{
					error: {
						code: 'INVALID_KIOSK_REGISTRATION',
						message: 'ข้อมูลรูปจากบัตรไม่ถูกต้อง'
					}
				},
				{ status: 400, headers: noStoreHeaders }
			);
		}
		return json(
			{
				error: { code: 'KIOSK_REGISTRATION_FAILED', message: 'ลงทะเบียนไม่สำเร็จ กรุณาลองอีกครั้ง' }
			},
			{ status: 503, headers: noStoreHeaders }
		);
	}
};
