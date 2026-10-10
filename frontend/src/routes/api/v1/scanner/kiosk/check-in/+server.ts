import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import {
	checkInSelectedMembers,
	isKioskThaidCheckInAllowed,
	kioskCheckInInputSchema,
	KioskThaidIdentityMismatchError,
	saveKioskCheckInCardPhoto
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
		let result;
		if (parsed.data.source === 'thaid') {
			// The schema guarantees the id; this keeps a thaid check-in from ever taking the unbound path.
			const sessionId = parsed.data.thaid_session_id;
			if (!sessionId) {
				return json(
					{ error: { code: 'INVALID_CHECK_IN_INPUT', message: 'รายชื่อผู้เข้าพักไม่ถูกต้อง' } },
					{ status: 400, headers: noStoreHeaders }
				);
			}
			// FR-KTD-27: the gate is re-checked, then the session is claimed synchronously before any
			// write so a double submit cannot check in twice.
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
			const citizen = consumeKioskSession(sessionId, principal.registry_id);
			if (!citizen) return thaidSessionInvalid();
			try {
				result = await checkInSelectedMembers(
					principal.shelter_code,
					parsed.data.primary_evacuee_id,
					parsed.data.evacuee_ids,
					{ requiredPrimaryCitizenId: citizen.pid }
				);
			} catch (error) {
				if (error instanceof KioskThaidIdentityMismatchError) return thaidSessionInvalid();
				// Nothing was committed by an aborted write: give the scan back so the kiosk can retry.
				releaseKioskSession(sessionId, principal.registry_id);
				throw error;
			}
			if (result.every((member) => member.status === 'failed')) {
				releaseKioskSession(sessionId, principal.registry_id);
			}
		} else {
			result = await checkInSelectedMembers(
				principal.shelter_code,
				parsed.data.primary_evacuee_id,
				parsed.data.evacuee_ids
			);
		}
		const { photo, citizen_id: citizenId } = parsed.data;
		if (photo && citizenId) {
			// Best effort after the authoritative check-in writes; it reports failure as an outcome
			// and never throws, so the response is never failed by the photo.
			await saveKioskCheckInCardPhoto(principal.shelter_code, principal.device_id, {
				primaryEvacueeId: parsed.data.primary_evacuee_id,
				citizenId,
				photo,
				results: result
			});
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
