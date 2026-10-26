import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/features/kiosk-devices/server', async () => {
	const actual = await vi.importActual<typeof import('$lib/features/kiosk-devices/server')>(
		'$lib/features/kiosk-devices/server'
	);
	return { ...actual, scannerServerRepository: { getDeviceByDeviceId: vi.fn() } };
});
vi.mock('$lib/server/scanners/staff-pin-store', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/staff-pin-store')>(
		'$lib/server/scanners/staff-pin-store'
	);
	return { ...actual, staffPinSecretStore: { get: vi.fn() } };
});
vi.mock('$lib/server/shelters.admin', () => ({ findMasterByCode: vi.fn() }));
vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', () => ({ readGroupDoc: vi.fn() }));

import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/kiosk-devices/server';
import { hashScannerSecret } from '$lib/server/scanners/device-credentials';
import { readGroupDoc } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { staffPinSecretStore, type StaffPinSecret } from '$lib/server/scanners/staff-pin-store';
import { STAFF_PIN_WRONG_DELAY_MS } from '$lib/server/scanners/staff-pin-throttle';

const SECRET = 'sk_scan_test_secret';

function deviceDoc(overrides: Record<string, unknown> = {}) {
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
		secret_hash: hashScannerSecret(SECRET),
		secret_prefix: 'sk_scan_aaaaaaaa...',
		status: 'active',
		last_seen_at: null,
		staff_pin_set: true,
		staff_pin_is_default: false,
		staff_pin_updated_at: '2026-10-09T08:30:00Z',
		staff_pin_updated_by: 'admin-1',
		screen_type: 'portrait',
		banner_group_id: 'kiosk_banner_group:g1',
		...overrides
	};
}

const secretDoc: StaffPinSecret = {
	_id: 'staff_pin:kiosk-01',
	_rev: '1-s',
	type: 'scanner_staff_pin',
	schema_v: 1,
	device_id: 'kiosk-01',
	pin: '482913',
	is_default: false,
	updated_at: '2026-10-09T08:30:00Z',
	updated_by: 'admin-1'
};

function request(body: unknown, headers: Record<string, string> = {}): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/kiosk/device-info', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-device-id': 'kiosk-01',
				'x-device-secret': SECRET,
				...headers
			},
			body: typeof body === 'string' ? body : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

/** POST, letting the fake clock run past the delay a wrong PIN is held for. */
async function post(event: RequestEvent): Promise<Response> {
	const pending = POST(event);
	await vi.advanceTimersByTimeAsync(STAFF_PIN_WRONG_DELAY_MS);
	return pending;
}

describe('POST /api/v1/kiosk/device-info', () => {
	const mockLookup = vi.mocked(scannerServerRepository.getDeviceByDeviceId);
	const mockSecret = vi.mocked(staffPinSecretStore.get);
	const mockShelter = vi.mocked(findMasterByCode);
	const mockGroup = vi.mocked(readGroupDoc);
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.useFakeTimers();
		vi.clearAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		mockLookup.mockResolvedValue(deviceDoc() as never);
		mockSecret.mockResolvedValue(secretDoc);
		mockShelter.mockResolvedValue({ code: 'SH001', name: '  ศูนย์พักพิงหาดใหญ่  ' } as never);
		mockGroup.mockResolvedValue({
			_id: 'kiosk_banner_group:g1',
			name: 'กลุ่มหน้าประตู'
		} as never);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns the device info for the right PIN, without the PIN, no-store', async () => {
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = await response.json();
		expect(body).toEqual({
			device: {
				device_id: 'kiosk-01',
				name: 'Kiosk 1',
				station_name: 'ประตู 1',
				screen_type: 'portrait'
			},
			shelter: { code: 'SH001', name: 'ศูนย์พักพิงหาดใหญ่' },
			staff_pin: {
				set: true,
				is_default: false,
				updated_at: '2026-10-09T08:30:00Z',
				updated_by: 'admin-1'
			},
			banner_group: { id: 'kiosk_banner_group:g1', name: 'กลุ่มหน้าประตู' }
		});
		expect(JSON.stringify(body)).not.toContain('482913');
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('device=kiosk-01');
		expect(logged).toContain('result=ok');
		expect(logged).not.toContain('482913');
	});

	it('returns 401 staff_pin_invalid for a wrong PIN and leaks no device data', async () => {
		const response = await post(request({ pin: '111112' }));

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error.code).toBe('staff_pin_invalid');
		expect(Object.keys(body)).toEqual(['error']);
		expect(JSON.stringify(body)).not.toContain('Kiosk 1');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('returns 409 staff_pin_not_set when the device has no PIN', async () => {
		mockSecret.mockResolvedValueOnce(null);
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('staff_pin_not_set');
	});

	it('returns 401 DEVICE_AUTH_FAILED for a bad device secret and never checks the PIN', async () => {
		const response = await POST(request({ pin: '482913' }, { 'x-device-secret': 'wrong' }));

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(mockSecret).not.toHaveBeenCalled();
	});

	it('answers banner_group null when the device has no group', async () => {
		mockLookup.mockResolvedValueOnce(deviceDoc({ banner_group_id: null }) as never);
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect((await response.json()).banner_group).toBeNull();
		expect(mockGroup).not.toHaveBeenCalled();
	});

	it('answers banner_group null when the group was deleted', async () => {
		mockGroup.mockResolvedValueOnce(null);
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect((await response.json()).banner_group).toBeNull();
	});

	it('still answers 200 with banner_group null when reading the banner group fails', async () => {
		mockGroup.mockRejectedValueOnce(new Error('couchdb timeout'));
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect((await response.json()).banner_group).toBeNull();
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('result=ok');
		expect(logged).not.toContain('result=error');
	});

	it('falls back to the shelter code when the shelter is not found', async () => {
		mockShelter.mockResolvedValueOnce(null);
		const response = await POST(request({ pin: '482913' }));

		expect((await response.json()).shelter).toEqual({ code: 'SH001', name: 'SH001' });
	});

	it('still answers 200 with the shelter code as name when the shelter lookup fails', async () => {
		mockShelter.mockRejectedValueOnce(new Error('couchdb timeout'));
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect((await response.json()).shelter).toEqual({ code: 'SH001', name: 'SH001' });
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('result=ok');
		expect(logged).not.toContain('result=error');
	});
});
