import type { RequestHandler } from './$types';
import {
	screenTypeOf,
	staffPinStateOf,
	type PersistedScannerDevice
} from '$lib/features/kiosk-devices/server';
import { readGroupDoc } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { staffPinJson, withDeviceStaffPin } from '$lib/server/scanners/staff-pin-http';
import { findMasterByCode } from '$lib/server/shelters.admin';

export const prerender = false;

/** Audit line: device, time, outcome. Never the PIN. */
function audit(deviceId: string, outcome: string): void {
	console.info(
		`[scanner-device-info] device=${deviceId} result=${outcome} at=${new Date().toISOString()}`
	);
}

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
 * The device and PIN are checked exactly as `staff-pin/verify` does (`withDeviceStaffPin`), so
 * both share one guessing budget. The PIN is never echoed or logged, nor who last set it (staff
 * identity is not for the kiosk screen); the banner group is `{id, name}` only, never its devices.
 */
export const POST: RequestHandler = ({ request }) =>
	withDeviceStaffPin(request, audit, async (device) => {
		const pinState = staffPinStateOf(device);
		return staffPinJson(
			{
				device: {
					device_id: device.device_id,
					name: device.name,
					station_name: device.station_name,
					screen_type: screenTypeOf(device)
				},
				shelter: { code: device.shelter_code, name: await shelterNameOf(device.shelter_code) },
				// A 200 means the PIN matched, so it is always set: only whether it is the default.
				staff_pin: {
					is_default: pinState.staff_pin_is_default,
					updated_at: pinState.staff_pin_updated_at
				},
				banner_group: await bannerGroupOf(device)
			},
			200
		);
	});
