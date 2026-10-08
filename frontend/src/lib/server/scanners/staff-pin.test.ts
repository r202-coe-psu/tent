import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import {
	generateStaffPin,
	StaffPinAttemptLimiter,
	staffPinMatches,
	StaffPinUnavailableError,
	verifyDeviceStaffPin
} from './staff-pin';
import type { StaffPinSecret } from './staff-pin-store';
// eslint-disable-next-line no-restricted-imports -- server-side test of the server-safe domain schema
import {
	isTrivialStaffPin,
	type PersistedScannerDevice
} from '$lib/features/scanners/domain/scanner.schema';

function device(overrides: Record<string, unknown> = {}): PersistedScannerDevice {
	return {
		_id: 'scanner_device:kiosk-01',
		_rev: '1-a',
		type: 'scanner_device',
		schema_v: 2,
		created_at: '2026-10-08T00:00:00Z',
		updated_at: '2026-10-08T00:00:00Z',
		created_by: 'sa',
		device_id: 'kiosk-01',
		name: 'Kiosk 1',
		shelter_code: 'SH001',
		station_name: 'ประตู 1',
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		status: 'active',
		last_seen_at: null,
		staff_pin_set: true,
		staff_pin_is_default: true,
		staff_pin_updated_at: '2026-10-08T00:00:00Z',
		staff_pin_updated_by: 'sa',
		...overrides
	} as PersistedScannerDevice;
}

function secret(pin: string): StaffPinSecret {
	return {
		_id: 'staff_pin:kiosk-01',
		_rev: '1-s',
		type: 'scanner_staff_pin',
		schema_v: 1,
		device_id: 'kiosk-01',
		pin,
		is_default: true,
		updated_at: '2026-10-08T00:00:00Z',
		updated_by: 'sa'
	};
}

describe('staff-pin helpers', () => {
	it('generates 6-digit, non-trivial PINs', () => {
		for (let i = 0; i < 200; i += 1) {
			const pin = generateStaffPin();
			expect(pin).toMatch(/^\d{6}$/);
			expect(isTrivialStaffPin(pin)).toBe(false);
		}
	});

	it('compares PINs without throwing on length mismatch', () => {
		expect(staffPinMatches('482913', '482913')).toBe(true);
		expect(staffPinMatches('482914', '482913')).toBe(false);
		expect(staffPinMatches('4829', '482913')).toBe(false);
	});
});

describe('StaffPinAttemptLimiter', () => {
	it('locks after 5 failures for 5 minutes, then resets', () => {
		let clock = 1_000_000;
		const limiter = new StaffPinAttemptLimiter(5, 5 * 60 * 1000, () => clock);

		for (let remaining = 4; remaining >= 1; remaining -= 1) {
			expect(limiter.recordFailure('kiosk-01')).toEqual({ locked: false, remaining });
		}
		expect(limiter.recordFailure('kiosk-01')).toEqual({ locked: true, retryAfterS: 300 });
		expect(limiter.lockedFor('kiosk-01')).toBe(300);
		expect(limiter.lockedFor('kiosk-02')).toBeNull();

		clock += 299_500;
		expect(limiter.lockedFor('kiosk-01')).toBe(1);
		clock += 500;
		expect(limiter.lockedFor('kiosk-01')).toBeNull();
		expect(limiter.recordFailure('kiosk-01')).toEqual({ locked: false, remaining: 4 });
	});
});

describe('verifyDeviceStaffPin', () => {
	let limiter: StaffPinAttemptLimiter;
	const get = vi.fn<(deviceId: string) => Promise<StaffPinSecret | null>>();
	const deps = () => ({ store: { get }, limiter });

	beforeEach(() => {
		limiter = new StaffPinAttemptLimiter();
		get.mockReset();
		get.mockResolvedValue(secret('482913'));
	});

	it('accepts the right PIN and resets the failure counter', async () => {
		const d = device();
		expect(await verifyDeviceStaffPin(d, '111112', deps())).toEqual({
			kind: 'wrong',
			remaining: 4
		});
		expect(await verifyDeviceStaffPin(d, '482913', deps())).toEqual({ kind: 'ok' });
		expect(await verifyDeviceStaffPin(d, '111112', deps())).toEqual({
			kind: 'wrong',
			remaining: 4
		});
		expect(get).toHaveBeenCalledWith('kiosk-01');
	});

	it('locks after the 5th wrong PIN and rejects even the right PIN while locked', async () => {
		const d = device();
		for (let i = 0; i < 4; i += 1) await verifyDeviceStaffPin(d, '000001', deps());
		expect(await verifyDeviceStaffPin(d, '000001', deps())).toEqual({
			kind: 'locked',
			retryAfterS: 300
		});
		get.mockClear();
		expect((await verifyDeviceStaffPin(d, '482913', deps())).kind).toBe('locked');
		// A locked device does not even reach the secrets store.
		expect(get).not.toHaveBeenCalled();
	});

	it('reports not_set when no PIN doc exists, whatever the registry metadata says', async () => {
		get.mockResolvedValue(null);
		expect(await verifyDeviceStaffPin(device(), '482913', deps())).toEqual({ kind: 'not_set' });
		expect(await verifyDeviceStaffPin(device({ schema_v: 1 }), '482913', deps())).toEqual({
			kind: 'not_set'
		});
		// not_set never burns an attempt.
		expect(limiter.lockedFor('kiosk-01')).toBeNull();
	});

	it('propagates a store failure instead of accepting any PIN', async () => {
		get.mockRejectedValue(new StaffPinUnavailableError());
		await expect(verifyDeviceStaffPin(device(), '482913', deps())).rejects.toBeInstanceOf(
			StaffPinUnavailableError
		);
	});
});
