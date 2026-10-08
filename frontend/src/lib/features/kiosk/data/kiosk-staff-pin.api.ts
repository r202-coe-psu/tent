export const KIOSK_STAFF_PIN_VERIFY_PATH = '/api/v1/scanner/kiosk/staff-pin/verify';
export const KIOSK_STAFF_PIN_TIMEOUT_MS = 8_000;

/**
 * What the server said about a staff PIN entered at this kiosk. The scanner client adds the device
 * credential on the way, so the server checks the PIN of this kiosk only.
 * - `wrong`: the PIN was not right; staff may try again (no limit on tries).
 * - `not_set`: no PIN has been set for this kiosk, so staff cannot bypass here.
 * - `error`: anything else (PIN store unavailable, device not recognised, network, timeout).
 */
export type KioskStaffPinResult =
	{ kind: 'verified' } | { kind: 'wrong' } | { kind: 'not_set' } | { kind: 'error' };

/**
 * Checks a staff PIN with the server. Never throws and never logs the PIN: every failure is a
 * result the PIN panel can show.
 */
export async function verifyKioskStaffPin(
	pin: string,
	fetchFn: typeof fetch = fetch
): Promise<KioskStaffPinResult> {
	let response: Response;
	try {
		response = await fetchFn(KIOSK_STAFF_PIN_VERIFY_PATH, {
			method: 'POST',
			cache: 'no-store',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ pin }),
			signal: AbortSignal.timeout(KIOSK_STAFF_PIN_TIMEOUT_MS)
		});
	} catch {
		return { kind: 'error' };
	}
	const body = (await response.json().catch(() => null)) as {
		ok?: unknown;
		error?: { code?: unknown } | null;
	} | null;
	switch (response.status) {
		case 200:
			return body?.ok === true ? { kind: 'verified' } : { kind: 'error' };
		case 401:
			// Any other 401 code means the device credential failed, not the PIN.
			return body?.error?.code === 'staff_pin_invalid' ? { kind: 'wrong' } : { kind: 'error' };
		case 409:
			return body?.error?.code === 'staff_pin_not_set' ? { kind: 'not_set' } : { kind: 'error' };
		default:
			return { kind: 'error' };
	}
}
