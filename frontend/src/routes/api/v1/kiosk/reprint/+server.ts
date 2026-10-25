import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	scannerServerRepository,
	type PersistedScannerDevice
} from '$lib/features/kiosk-devices/server';
import {
	KioskInputError,
	KioskLookupUnavailableError,
	KioskReprintNotFoundError,
	KioskReprintStaffPinBusyError,
	KioskReprintStaffPinInvalidError,
	KioskReprintStaffPinNotSetError,
	KioskReprintUnverifiableError,
	KioskReprintVerifyFailedError,
	kioskReprintInputSchema,
	normalizeKioskPhone,
	reprintKioskLabels
} from '$lib/features/kiosk/server';
import { isKioskPhoneCheckInEnabled } from '$lib/features/kiosk/config';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError,
	ScannerDependencyError
} from '$lib/server/scanners/device-credentials';
import { StaffPinUnavailableError, verifyDeviceStaffPin } from '$lib/server/scanners/staff-pin';
import { staffPinThrottle } from '$lib/server/scanners/staff-pin-throttle';
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

/** Audit line for the PIN check: device, time, outcome. Never the PIN. */
function auditPinCheck(deviceId: string, outcome: string): void {
	console.info(
		`[scanner-staff-pin] verify device=${deviceId} result=${outcome} at=${new Date().toISOString()}`
	);
}

/** The staff PIN could not be checked (store down, turn not granted): fail closed with 503. */
class StaffPinCheckUnavailableError extends Error {}

/**
 * Reprint the QR labels of the phone owner's household after the visitor types the last four
 * digits of the owner's citizen id, or a staff PIN for this kiosk. Read-only; the phone lookup
 * lists who can be reprinted.
 */
export const POST: RequestHandler = async ({ request }) => {
	let device: PersistedScannerDevice | null = null;
	try {
		const principal = await authenticateScannerDevice(
			request.headers.get('x-device-id') ?? '',
			request.headers.get('x-device-secret') ?? '',
			{
				// Capture the doc authentication already loaded, so the PIN check needs no 2nd read.
				getDeviceByDeviceId: async (deviceId) => {
					device = await scannerServerRepository.getDeviceByDeviceId(deviceId);
					return device;
				}
			}
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

		// The PIN checked is always the authenticated device's, never an id from the body.
		const verifyStaffPin = async (pin: string) => {
			const authenticated = device as PersistedScannerDevice | null;
			if (!authenticated) throw new ScannerDependencyError('Authenticated device unavailable');
			try {
				const result = await staffPinThrottle.run(authenticated.device_id, async () => {
					const checked = await verifyDeviceStaffPin(authenticated, pin);
					auditPinCheck(authenticated.device_id, checked.kind);
					return checked;
				});
				if (result.kind === 'busy') auditPinCheck(authenticated.device_id, 'busy');
				return result;
			} catch (error) {
				auditPinCheck(
					authenticated.device_id,
					error instanceof StaffPinUnavailableError ? 'unavailable' : 'error'
				);
				throw new StaffPinCheckUnavailableError();
			}
		};
		const members = await reprintKioskLabels(principal.shelter_code, parsed.data, {
			verifyStaffPin
		});
		if ('staff_pin' in parsed.data) {
			console.info(
				`[kiosk-reprint] staff_pin_bypass device=${principal.device_id} shelter=${principal.shelter_code} primary=${parsed.data.primary_evacuee_id} labels=${members.length} at=${new Date().toISOString()}`
			);
		}
		await scannerServerRepository.updateDeviceLastSeen(principal.registry_id).catch(() => {});
		return json({ shelter_code: principal.shelter_code, members }, { headers: noStoreHeaders });
	} catch (error) {
		if (error instanceof KioskReprintVerifyFailedError) {
			return errorResponse(403, 'KIOSK_REPRINT_VERIFY_FAILED', 'เลข 4 หลักท้ายไม่ถูกต้อง');
		}
		if (error instanceof KioskReprintStaffPinInvalidError) {
			return errorResponse(401, 'KIOSK_REPRINT_STAFF_PIN_INVALID', 'PIN ไม่ถูกต้อง');
		}
		if (error instanceof KioskReprintStaffPinNotSetError) {
			return errorResponse(
				409,
				'staff_pin_not_set',
				'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
			);
		}
		if (error instanceof KioskReprintStaffPinBusyError) {
			return errorResponse(429, 'RATE_LIMITED', 'กำลังตรวจ PIN อยู่ กรุณารอสักครู่');
		}
		if (error instanceof StaffPinCheckUnavailableError) {
			return errorResponse(503, DEPENDENCY_UNAVAILABLE, 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน');
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
