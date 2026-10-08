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
 * Staff bypass PIN (per scanner device): generation, constant-time check, wrong-attempt lockout.
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

// ---------------------------------------------------------------- Wrong-attempt lockout

export const STAFF_PIN_MAX_FAILURES = 5;
export const STAFF_PIN_LOCK_MS = 5 * 60 * 1000;

interface AttemptState {
	failures: number;
	lockedUntil: number | null;
}

/**
 * In-memory wrong-PIN counter per scanner `device_id`. Five wrong PINs lock the device for five
 * minutes; a correct PIN or an expired lock resets it. Process-local by design (single Node
 * process per deployment unit); a restart clears it, which is acceptable for a 10^6 keyspace
 * behind authenticated device credentials.
 */
export class StaffPinAttemptLimiter {
	private readonly states = new Map<string, AttemptState>();

	constructor(
		private readonly maxFailures = STAFF_PIN_MAX_FAILURES,
		private readonly lockMs = STAFF_PIN_LOCK_MS,
		private readonly clock: () => number = Date.now
	) {}

	/** Seconds until the lock lifts, or `null` when the device may try. */
	lockedFor(deviceId: string): number | null {
		const state = this.states.get(deviceId);
		if (!state?.lockedUntil) return null;
		const remainingMs = state.lockedUntil - this.clock();
		if (remainingMs <= 0) {
			this.states.delete(deviceId);
			return null;
		}
		return Math.ceil(remainingMs / 1000);
	}

	/** Records a wrong PIN; returns the attempts left or the new lock duration. */
	recordFailure(
		deviceId: string
	): { locked: false; remaining: number } | { locked: true; retryAfterS: number } {
		const state = this.states.get(deviceId) ?? { failures: 0, lockedUntil: null };
		state.failures += 1;
		if (state.failures >= this.maxFailures) {
			state.lockedUntil = this.clock() + this.lockMs;
			this.states.set(deviceId, state);
			return { locked: true, retryAfterS: Math.ceil(this.lockMs / 1000) };
		}
		this.states.set(deviceId, state);
		return { locked: false, remaining: this.maxFailures - state.failures };
	}

	reset(deviceId: string): void {
		this.states.delete(deviceId);
	}
}

export const staffPinAttemptLimiter = new StaffPinAttemptLimiter();

export type StaffPinVerifyResult =
	| { kind: 'ok' }
	| { kind: 'wrong'; remaining: number }
	| { kind: 'locked'; retryAfterS: number }
	| { kind: 'not_set' };

/**
 * Check a kiosk-supplied PIN for an already-authenticated device. Lock state is checked first so a
 * locked device learns nothing; a device with no stored PIN is `not_set` (bypass blocked). Throws
 * {@link StaffPinUnavailableError} when the secrets store cannot be read.
 */
export async function verifyDeviceStaffPin(
	device: PersistedScannerDevice,
	pin: string,
	deps: {
		store?: Pick<StaffPinSecretStore, 'get'>;
		limiter?: StaffPinAttemptLimiter;
	} = {}
): Promise<StaffPinVerifyResult> {
	const store = deps.store ?? staffPinSecretStore;
	const limiter = deps.limiter ?? staffPinAttemptLimiter;

	const lockedFor = limiter.lockedFor(device.device_id);
	if (lockedFor !== null) return { kind: 'locked', retryAfterS: lockedFor };

	const secret = await store.get(device.device_id);
	if (!secret) return { kind: 'not_set' };

	if (staffPinMatches(pin, secret.pin)) {
		limiter.reset(device.device_id);
		return { kind: 'ok' };
	}
	const failure = limiter.recordFailure(device.device_id);
	return failure.locked
		? { kind: 'locked', retryAfterS: failure.retryAfterS }
		: { kind: 'wrong', remaining: failure.remaining };
}
