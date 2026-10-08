export const KIOSK_STAFF_PIN_VERIFY_PATH = '/api/v1/scanner/kiosk/staff-pin/verify';
export const KIOSK_STAFF_PIN_TIMEOUT_MS = 8_000;

/**
 * What the server said about a staff PIN entered at this kiosk. The scanner client adds the device
 * credential on the way, so the server checks the PIN of this kiosk only.
 * - `wrong`: the PIN was not right; `remaining` tries before the kiosk is locked.
 * - `locked`: too many wrong PINs; try again after `retryAfterS` seconds.
 * - `not_set`: no PIN has been set for this kiosk, so staff cannot bypass here.
 * - `error`: anything else (no key on the server, device not recognised, network, timeout).
 */
export type KioskStaffPinResult =
	| { kind: 'verified' }
	| { kind: 'wrong'; remaining: number }
	| { kind: 'locked'; retryAfterS: number }
	| { kind: 'not_set' }
	| { kind: 'error' };

function nonNegativeInt(value: unknown): number | null {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

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
		remaining_attempts?: unknown;
		retry_after_s?: unknown;
	} | null;
	switch (response.status) {
		case 200:
			return body?.ok === true ? { kind: 'verified' } : { kind: 'error' };
		case 401: {
			// Without a count it was the device credential that failed, not the PIN.
			const remaining = nonNegativeInt(body?.remaining_attempts);
			return remaining === null ? { kind: 'error' } : { kind: 'wrong', remaining };
		}
		case 423: {
			const retryAfterS = nonNegativeInt(body?.retry_after_s);
			return retryAfterS === null ? { kind: 'error' } : { kind: 'locked', retryAfterS };
		}
		case 409:
			return body?.error?.code === 'staff_pin_not_set' ? { kind: 'not_set' } : { kind: 'error' };
		default:
			return { kind: 'error' };
	}
}
