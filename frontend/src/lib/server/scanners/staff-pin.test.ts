import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', () => ({ adminRaw: vi.fn() }));

import {
	generateStaffPin,
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

describe('verifyDeviceStaffPin', () => {
	const get = vi.fn<(deviceId: string) => Promise<StaffPinSecret | null>>();
	const deps = () => ({ store: { get } });

	beforeEach(() => {
		get.mockReset();
		get.mockResolvedValue(secret('482913'));
	});

	it('accepts the right PIN and rejects a wrong one', async () => {
		const d = device();
		expect(await verifyDeviceStaffPin(d, '111112', deps())).toEqual({ kind: 'wrong' });
		expect(await verifyDeviceStaffPin(d, '482913', deps())).toEqual({ kind: 'ok' });
		expect(get).toHaveBeenCalledWith('kiosk-01');
	});

	it('never locks the device, however many wrong PINs come first', async () => {
		const d = device();
		for (let i = 0; i < 20; i += 1) {
			expect(await verifyDeviceStaffPin(d, '000001', deps())).toEqual({ kind: 'wrong' });
		}
		expect(await verifyDeviceStaffPin(d, '482913', deps())).toEqual({ kind: 'ok' });
	});

	it('reports not_set when no PIN doc exists, whatever the registry metadata says', async () => {
		get.mockResolvedValue(null);
		expect(await verifyDeviceStaffPin(device(), '482913', deps())).toEqual({ kind: 'not_set' });
		expect(await verifyDeviceStaffPin(device({ schema_v: 1 }), '482913', deps())).toEqual({
			kind: 'not_set'
		});
	});

	it('propagates a store failure instead of accepting any PIN', async () => {
		get.mockRejectedValue(new StaffPinUnavailableError());
		await expect(verifyDeviceStaffPin(device(), '482913', deps())).rejects.toBeInstanceOf(
			StaffPinUnavailableError
		);
	});
});
