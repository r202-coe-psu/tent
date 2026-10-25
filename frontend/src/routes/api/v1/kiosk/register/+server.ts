import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { ServiceError } from '$lib/server/couch-admin';
import { isKioskWalkInRegistrationEnabled } from '$lib/features/kiosk/config';
import {
	KioskPhoneDuplicateError,
	KioskRegistrationBlockedError,
	KioskPhotoValidationError,
	decodeKioskPhoto,
	isStaleKioskConsent,
	kioskWalkInRegistrationInputSchema,
	registerKioskThaidWalkIn,
	registerKioskWalkIn
} from '$lib/features/kiosk/server/kiosk-register.server';
import { toLabelIdentity } from '$lib/features/kiosk/server/kiosk-check-in.server';
import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server/kiosk-thaid-gate.server';
import {
	consumeKioskSession,
	getKioskSessionForDevice,
	releaseKioskSession
} from '$lib/server/thaid-scan-session';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';

export const prerender = false;
const noStoreHeaders = { 'cache-control': 'no-store', pragma: 'no-cache' };

function thaidSessionInvalid(): Response {
	return json(
		{
			error: {
				code: 'KIOSK_THAID_SESSION_INVALID',
				message: 'การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่'
			}
		},
		{ status: 409, headers: noStoreHeaders }
	);
}

export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const body = await request.json().catch(() => null);
		const parsed = kioskWalkInRegistrationInputSchema.safeParse(body);
		if (!parsed.success && isStaleKioskConsent(body)) {
			return json(
				{
					error: {
						code: 'KIOSK_CONSENT_EXPIRED',
						message: 'การยินยอมหมดเวลาแล้ว กรุณากดยินยอมอีกครั้ง'
					}
				},
				{ status: 400, headers: noStoreHeaders }
			);
		}
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
		const input = parsed.data;
		if (input.source === 'smart-card' && input.photo) {
			try {
				decodeKioskPhoto(input.photo);
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
		const device = {
			shelterCode: principal.shelter_code,
			deviceId: principal.device_id,
			stationName: principal.station_name
		};
		let evacuee;
		if (input.source === 'thaid') {
			if (!(await isKioskThaidCheckInAllowed(principal.shelter_code, { shelter }))) {
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
			// The citizen comes only from the server-held session, claimed before any write so a
			// double submit cannot register twice; a session minted for another shelter is invalid.
			const session = getKioskSessionForDevice(input.session_id, principal.registry_id);
			if (session?.binding?.shelter_code !== principal.shelter_code) return thaidSessionInvalid();
			const citizen = consumeKioskSession(input.session_id, principal.registry_id);
			if (!citizen) return thaidSessionInvalid();
			try {
				evacuee = await registerKioskThaidWalkIn(
					device,
					citizen,
					input.consent,
					input.phone,
					input.started_at
				);
			} catch (error) {
				// Nothing was written: give the scan back so the kiosk can retry. A record that already
				// exists will not go away, so that session stays used.
				if (!(error instanceof KioskRegistrationBlockedError)) {
					releaseKioskSession(input.session_id, principal.registry_id);
				}
				throw error;
			}
		} else {
			evacuee = await registerKioskWalkIn(
				principal.shelter_code,
				principal.device_id,
				principal.station_name,
				input.card,
				input.photo,
				input.consent,
				input.phone,
				input.started_at
			);
		}
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		// The QR is the evacuee id itself (same as check-in), so the kiosk can print the label at once.
		return json(
			{
				status: 'created',
				evacuee_id: evacuee._id,
				qr_payload: evacuee._id,
				label: toLabelIdentity(evacuee),
				consent_ref: evacuee.consent.ref,
				consent_mode: evacuee.consent.mode
			},
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
		if (error instanceof KioskPhoneDuplicateError) {
			return json(
				{
					error: {
						code: 'KIOSK_PHONE_DUPLICATE',
						message: 'เบอร์โทรศัพท์นี้ถูกใช้ลงทะเบียนแล้ว กรุณากรอกเบอร์อื่น หรือกด「ไม่มีเบอร์」'
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
