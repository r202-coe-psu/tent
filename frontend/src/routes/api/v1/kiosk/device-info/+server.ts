import type { RequestHandler } from './$types';
import {
	scannerServerRepository,
	staffPinStateOf,
	type PersistedScannerDevice
} from '$lib/features/kiosk-devices/server';
// eslint-disable-next-line no-restricted-imports -- server-safe domain module; feature barrel pulls client UI/query code
import { screenTypeOf } from '$lib/features/shared/domain/kiosk-screen';
import { readGroupDoc } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import {
	authenticateScannerDevice,
	DEVICE_AUTH_FAILED,
	DEPENDENCY_UNAVAILABLE,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { StaffPinUnavailableError, verifyDeviceStaffPin } from '$lib/server/scanners/staff-pin';
import { staffPinJson } from '$lib/server/scanners/staff-pin-http';
import { staffPinThrottle } from '$lib/server/scanners/staff-pin-throttle';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

/** The `pin` field of the body, whatever its shape; a malformed one is checked as a wrong PIN. */
function suppliedPin(body: unknown): unknown {
	return body && typeof body === 'object' ? (body as { pin?: unknown }).pin : undefined;
}

/** Audit line: device, time, outcome. Never the PIN. */
function audit(deviceId: string, outcome: string): void {
	console.info(
		`[scanner-device-info] device=${deviceId} result=${outcome} at=${new Date().toISOString()}`
	);
}

const UNAVAILABLE = {
	error: { code: DEPENDENCY_UNAVAILABLE, message: 'บริการตรวจสอบ PIN ไม่พร้อมใช้งาน' }
};

/** The shelter's display name; its code when the shelter has no name or the lookup fails. */
async function shelterNameOf(code: string): Promise<string> {
	try {
		return (await findMasterByCode(code))?.name?.trim() || code;
	} catch {
		return code;
	}
}

/**
 * The device's banner group as `{id, name}`; null when it has none, the group was deleted, or
 * reading it fails (the group is a nicety, not worth a 503). Reads only the group doc.
 */
async function bannerGroupOf(
	device: PersistedScannerDevice
): Promise<{ id: string; name: string } | null> {
	if (!device.banner_group_id) return null;
	try {
		const group = await readGroupDoc(device.banner_group_id);
		return group ? { id: group._id, name: group.name } : null;
	} catch {
		return null;
	}
}

/**
 * Kiosk staff "device info" panel: after the staff PIN typed on the kiosk is checked for *this*
 * device, answer who the kiosk is (device, shelter, staff-PIN state, banner group).
 * Authenticated with the scanner's device credentials, and the PIN goes through the same
 * per-device `staffPinThrottle` queue as `staff-pin/verify`, so both share one guessing budget.
 * The PIN is never echoed or logged; the banner group is `{id, name}` only, never its devices.
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
		return staffPinJson(UNAVAILABLE, 503);
	}
	const authenticated = device as PersistedScannerDevice | null;
	if (!authenticated) return staffPinJson(UNAVAILABLE, 503);

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
			case 'ok': {
				const pinState = staffPinStateOf(authenticated);
				const shelterName = await shelterNameOf(authenticated.shelter_code);
				return staffPinJson(
					{
						device: {
							device_id: authenticated.device_id,
							name: authenticated.name,
							station_name: authenticated.station_name,
							screen_type: screenTypeOf(authenticated)
						},
						shelter: {
							code: authenticated.shelter_code,
							name: shelterName
						},
						staff_pin: {
							set: pinState.staff_pin_set,
							is_default: pinState.staff_pin_is_default,
							updated_at: pinState.staff_pin_updated_at,
							updated_by: pinState.staff_pin_updated_by
						},
						banner_group: await bannerGroupOf(authenticated)
					},
					200
				);
			}
		}
	} catch (error) {
		audit(
			authenticated.device_id,
			error instanceof StaffPinUnavailableError ? 'unavailable' : 'error'
		);
		return staffPinJson(UNAVAILABLE, 503);
	}
};
