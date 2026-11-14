import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import {
	checkOutSelectedMembers,
	isKioskThaidCheckInAllowed,
	KioskCheckOutIdentityMismatchError,
	kioskCheckOutInputSchema
} from '$lib/features/kiosk/server';
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

const invalidInput = () =>
	json(
		{ error: { code: 'INVALID_CHECK_OUT_INPUT', message: 'รายชื่อผู้เช็คเอาต์ไม่ถูกต้อง' } },
		{ status: 400, headers: noStoreHeaders }
	);

const thaidSessionInvalid = () =>
	json(
		{
			error: {
				code: 'KIOSK_THAID_SESSION_INVALID',
				message: 'การยืนยัน ThaiD หมดอายุหรือไม่ถูกต้อง กรุณาสแกนใหม่'
			}
		},
		{ status: 409, headers: noStoreHeaders }
	);

/**
 * #1401: an evacuee past Station 3 checks themselves (and chosen household members) out at the
 * kiosk with the ID card or ThaiD. No face check; the verified citizen must be the primary.
 */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			scannerServerRepository
		);
		const parsed = kioskCheckOutInputSchema.safeParse(await request.json().catch(() => null));
		if (!parsed.success) return invalidInput();
		const input = parsed.data;
		const writeOptions = {
			deviceId: principal.device_id,
			deviceLabel: principal.name.trim() || principal.device_id,
			destinationType: input.destination_type
		};
		let result;
		if (input.source === 'thaid') {
			// The schema guarantees the id; this keeps a thaid check-out from ever taking the card path.
			const sessionId = input.thaid_session_id;
			if (!sessionId) return invalidInput();
			if (!(await isKioskThaidCheckInAllowed(principal.shelter_code))) {
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
			// A session minted for another shelter is invalid here; checked before it is consumed.
			const session = getKioskSessionForDevice(sessionId, principal.registry_id);
			if (session?.binding?.shelter_code !== principal.shelter_code) return thaidSessionInvalid();
			// Claimed synchronously before any write so a double submit cannot check out twice.
			const citizen = consumeKioskSession(sessionId, principal.registry_id);
			if (!citizen) return thaidSessionInvalid();
			try {
				result = await checkOutSelectedMembers(
					principal.shelter_code,
					input.primary_evacuee_id,
					input.evacuee_ids,
					{ ...writeOptions, requiredPrimaryCitizenId: citizen.pid }
				);
			} catch (error) {
				if (error instanceof KioskCheckOutIdentityMismatchError) return thaidSessionInvalid();
				// Nothing was committed by an aborted write: give the scan back so the kiosk can retry.
				releaseKioskSession(sessionId, principal.registry_id);
				throw error;
			}
			if (!result.some((member) => member.status === 'checked_out')) {
				releaseKioskSession(sessionId, principal.registry_id);
			}
		} else {
			if (!input.citizen_id) return invalidInput();
			result = await checkOutSelectedMembers(
				principal.shelter_code,
				input.primary_evacuee_id,
				input.evacuee_ids,
				{ ...writeOptions, requiredPrimaryCitizenId: input.citizen_id }
			);
		}
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
		if (error instanceof KioskCheckOutIdentityMismatchError) {
			return json(
				{
					error: {
						code: 'KIOSK_CHECK_OUT_IDENTITY_MISMATCH',
						message: 'บัตรนี้ไม่ตรงกับผู้เช็คเอาต์ กรุณาติดต่อเจ้าหน้าที่'
					}
				},
				{ status: 409, headers: noStoreHeaders }
			);
		}
		return json(
			{
				error: {
					code: 'KIOSK_CHECK_OUT_FAILED',
					message: 'บันทึกการเช็คเอาต์ไม่สำเร็จ กรุณาลองอีกครั้ง'
				}
			},
			{ status: 500, headers: noStoreHeaders }
		);
	}
};
