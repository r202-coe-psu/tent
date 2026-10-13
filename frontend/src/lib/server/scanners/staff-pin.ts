import { timingSafeEqual } from 'node:crypto';
// eslint-disable-next-line no-restricted-imports -- server-safe domain schema; feature barrel pulls client UI/query code
import type { PersistedScannerDevice } from '$lib/features/kiosk-devices/domain/scanner.schema';
import { staffPinSecretStore, type StaffPinSecretStore } from './staff-pin-store';

export { generateStaffPin, StaffPinNotSetError, StaffPinUnavailableError } from './staff-pin-store';

/**
 * Staff bypass PIN (per scanner device): generation and constant-time check. Wrong PINs never
 * lock the device; access is gated by the device credentials the request must carry, and the
 * verify route slows guessing down with `staff-pin-throttle.ts`.
 *
 * The PIN lives in the admin-only `scanner_secrets` CouchDB database (see `staff-pin-store.ts`),
 * reachable only from this server with the admin client. Never log or return the PIN except
 * through the explicit reveal/create/regenerate paths.
 */

const STAFF_PIN_FORMAT = /^\d{6}$/;

/** Constant-time comparison of a supplied PIN with the stored one. */
export function staffPinMatches(supplied: string, expected: string): boolean {
	const a = Buffer.from(supplied, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	return a.length === b.length && timingSafeEqual(a, b);
}

export type StaffPinVerifyResult = { kind: 'ok' } | { kind: 'wrong' } | { kind: 'not_set' };

/**
 * Check a kiosk-supplied PIN for an already-authenticated device. Anything that is not 6 digits
 * (empty, short, letters, not a string) is a wrong PIN, checked before the store is read. A device
 * with no stored PIN is `not_set` (bypass blocked). Throws {@link StaffPinUnavailableError} when the
 * secrets store cannot be read.
 */
export async function verifyDeviceStaffPin(
	device: PersistedScannerDevice,
	pin: unknown,
	deps: { store?: Pick<StaffPinSecretStore, 'get'> } = {}
): Promise<StaffPinVerifyResult> {
	if (typeof pin !== 'string' || !STAFF_PIN_FORMAT.test(pin)) return { kind: 'wrong' };
	const store = deps.store ?? staffPinSecretStore;

	const secret = await store.get(device.device_id);
	if (!secret) return { kind: 'not_set' };

	return staffPinMatches(pin, secret.pin) ? { kind: 'ok' } : { kind: 'wrong' };
}
