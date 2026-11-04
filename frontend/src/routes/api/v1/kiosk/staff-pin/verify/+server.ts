import type { RequestHandler } from './$types';
import { staffPinJson, withDeviceStaffPin } from '$lib/server/scanners/staff-pin-http';

export const prerender = false;

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
export const POST: RequestHandler = ({ request }) =>
	withDeviceStaffPin(request, audit, async () => staffPinJson({ ok: true }, 200));
