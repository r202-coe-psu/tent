import { randomInt, timingSafeEqual } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import {
	isTrivialStaffPin,
	STAFF_PIN_LENGTH,
	type PersistedScannerDevice
} from '$lib/features/scanners/domain/scanner.schema';
import { staffPinSecretStore, type StaffPinSecretStore } from './staff-pin-store';

export { StaffPinNotSetError, StaffPinUnavailableError } from './staff-pin-store';

/**
 * Staff bypass PIN (per scanner device): generation and constant-time check. Wrong PINs are not
 * counted or locked out; access is gated by the device credentials the request must carry.
 *
 * The PIN lives in the admin-only `scanner_secrets` CouchDB database (see `staff-pin-store.ts`),
 * reachable only from this server with the admin client. Never log or return the PIN except
 * through the explicit reveal/create/regenerate paths.
 */

/** Uniform random 6-digit PIN that is never trivially guessable. */
export function generateStaffPin(): string {
	for (;;) {
		const pin = String(randomInt(0, 10 ** STAFF_PIN_LENGTH)).padStart(STAFF_PIN_LENGTH, '0');
		if (!isTrivialStaffPin(pin)) return pin;
	}
}

/** Constant-time comparison of a supplied PIN with the stored one. */
export function staffPinMatches(supplied: string, expected: string): boolean {
	const a = Buffer.from(supplied, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	return a.length === b.length && timingSafeEqual(a, b);
}

export type StaffPinVerifyResult = { kind: 'ok' } | { kind: 'wrong' } | { kind: 'not_set' };

/**
 * Check a kiosk-supplied PIN for an already-authenticated device. A device with no stored PIN is
 * `not_set` (bypass blocked). Throws {@link StaffPinUnavailableError} when the secrets store cannot
 * be read.
 */
export async function verifyDeviceStaffPin(
	device: PersistedScannerDevice,
	pin: string,
	deps: { store?: Pick<StaffPinSecretStore, 'get'> } = {}
): Promise<StaffPinVerifyResult> {
	const store = deps.store ?? staffPinSecretStore;

	const secret = await store.get(device.device_id);
	if (!secret) return { kind: 'not_set' };

	return staffPinMatches(pin, secret.pin) ? { kind: 'ok' } : { kind: 'wrong' };
}
