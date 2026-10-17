import type { RequestHandler } from './$types';
import {
	scannerServerRepository,
	type PersistedScannerDevice
} from '$lib/features/kiosk-devices/server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { StaffPinUnavailableError, verifyDeviceStaffPin } from '$lib/server/scanners/staff-pin';
import { staffPinJson } from '$lib/server/scanners/staff-pin-http';
import { staffPinThrottle } from '$lib/server/scanners/staff-pin-throttle';

export const prerender = false;

/** The `pin` field of the body, whatever its shape; a malformed one is checked as a wrong PIN. */
function suppliedPin(body: unknown): unknown {
	return body && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined;
}

/** Audit line: device, time, outcome. Never the PIN. */
function audit(deviceId: string, outcome: string): void {
	console.info(
		`[scanner-staff-pin] verify device=${deviceId} result=${outcome} at=${new Date().toISOString()}`
	);
}

/**
 * Kiosk staff bypass: check the PIN a staff member typed on the kiosk for *this* device.
 * Authenticated with the scanner's device credentials (attached by kiosk); the device
 * whose PIN is checked is always the authenticated one, never something from the body.
 * Never locks the device, but checks one PIN at a time per device and holds a wrong one ~1 s
 * (`staffPinThrottle`, shared across cluster workers) so guessing all 10⁶ PINs takes ~11 days. A PIN that is not 6 digits is held and
 * answered like a wrong one; a device whose queue is full gets `429 RATE_LIMITED` at once.
 */
export const POST: RequestHandler = async ({ request }) => {
	let device: PersistedScannerDevice | null = null;
	try {
		await authenticateScannerDevice(
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
	} catch (error) {
		if (error instanceof ScannerAuthError) {
			return staffPinJson(
				{ error: { code: DEVICE_AUTH_FAILED, message: 'ไม่สามารถยืนยันเครื่อง kiosk ได้' } },
				401
			);
		}
		return staffPinJson(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}
	const authenticated = device as PersistedScannerDevice | null;
	if (!authenticated) {
		return staffPinJson(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}

	const pin = suppliedPin(await request.json().catch(() => null));

	try {
		const result = await staffPinThrottle.run(authenticated.device_id, async () => {
			const checked = await verifyDeviceStaffPin(authenticated, pin);
			audit(authenticated.device_id, checked.kind);
			return checked;
		});
		switch (result.kind) {
			case 'busy':
				audit(authenticated.device_id, 'busy');
				return staffPinJson(
					{ error: { code: 'RATE_LIMITED', message: 'กำลังตรวจ PIN อยู่ กรุณารอสักครู่' } },
					429
				);
			case 'ok':
				return staffPinJson({ ok: true }, 200);
			case 'wrong':
				return staffPinJson(
					{ error: { code: 'staff_pin_invalid', message: 'PIN ไม่ถูกต้อง' } },
					401
				);
			case 'not_set':
				return staffPinJson(
					{
						error: {
							code: 'staff_pin_not_set',
							message: 'ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ'
						}
					},
					409
				);
		}
	} catch (error) {
		audit(
			authenticated.device_id,
			error instanceof StaffPinUnavailableError ? 'unavailable' : 'error'
		);
		return staffPinJson(
			{ error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' } },
			503
		);
	}
};
