import {
	kioskDeviceInfoSchema,
	toKioskDeviceInfo,
	type KioskDeviceInfo
} from '../domain/device-info';

export const KIOSK_DEVICE_INFO_PATH = '/api/v1/kiosk/device-info';
export const KIOSK_DEVICE_INFO_TIMEOUT_MS = 8_000;

/**
 * What the server said about a staff PIN asked to open the device-info panel. The scanner client
 * adds the device credential on the way, so the answer is about this kiosk only.
 * - `ok`: the PIN was right; `info` is what the panel shows.
 * - `wrong`: the PIN was not right; staff may try again.
 * - `not_set`: no PIN has been set for this kiosk, so the panel cannot open here.
 * - `error`: anything else (PIN store unavailable, device not recognised, bad body, network, timeout).
 */
export type KioskDeviceInfoResult =
	| { kind: 'ok'; info: KioskDeviceInfo }
	| { kind: 'wrong' }
	| { kind: 'not_set' }
	| { kind: 'error' };

/**
 * Asks the server for this kiosk's device info, gated by the staff PIN. Never throws and never logs
 * the PIN: every failure is a result the panel can show.
 */
export async function fetchKioskDeviceInfo(
	pin: string,
	fetchFn: typeof fetch = fetch
): Promise<KioskDeviceInfoResult> {
	let response: Response;
	try {
		response = await fetchFn(KIOSK_DEVICE_INFO_PATH, {
			method: 'POST',
			cache: 'no-store',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin }),
			signal: AbortSignal.timeout(KIOSK_DEVICE_INFO_TIMEOUT_MS)
		});
	} catch {
		return { kind: 'error' };
	}
	const body = (await response.json().catch(() => null)) as {
		error?: { code?: unknown } | null;
	} | null;
	switch (response.status) {
		case 200: {
			const parsed = kioskDeviceInfoSchema.safeParse(body);
			return parsed.success
				? { kind: 'ok', info: toKioskDeviceInfo(parsed.data) }
				: { kind: 'error' };
		}
		case 401:
			// Any other 401 code means the device credential failed, not the PIN.
			return body?.error?.code === 'staff_pin_invalid' ? { kind: 'wrong' } : { kind: 'error' };
		case 409:
			return body?.error?.code === 'staff_pin_not_set' ? { kind: 'not_set' } : { kind: 'error' };
		default:
			return { kind: 'error' };
	}
}
