import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({ env: {} }));
vi.mock('$lib/features/scanners/server', () => ({
	scannerServerRepository: { getDeviceByDeviceId: vi.fn() }
}));
vi.mock('$lib/server/scanners/staff-pin-store', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/staff-pin-store')>(
		'$lib/server/scanners/staff-pin-store'
	);
	return { ...actual, staffPinSecretStore: { get: vi.fn() } };
});

import { POST } from './+server';
import type { RequestEvent } from './$types';
import { scannerServerRepository } from '$lib/features/scanners/server';
import { hashScannerSecret } from '$lib/server/scanners/device-credentials';
import { staffPinAttemptLimiter } from '$lib/server/scanners/staff-pin';
import {
	staffPinSecretStore,
	StaffPinUnavailableError,
	type StaffPinSecret
} from '$lib/server/scanners/staff-pin-store';

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
		staff_pin_is_default: true,
		staff_pin_updated_at: '2026-10-08T00:00:00Z',
		staff_pin_updated_by: 'sa',
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
	is_default: true,
	updated_at: '2026-10-08T00:00:00Z',
	updated_by: 'sa'
};

function request(body: unknown, headers: Record<string, string> = {}): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/staff-pin/verify', {
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

describe('POST /api/v1/scanner/kiosk/staff-pin/verify', () => {
	const mockLookup = vi.mocked(scannerServerRepository.getDeviceByDeviceId);
	const mockSecret = vi.mocked(staffPinSecretStore.get);
	let info: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.clearAllMocks();
		info = vi.spyOn(console, 'info').mockImplementation(() => {});
		staffPinAttemptLimiter.reset('kiosk-01');
		mockLookup.mockResolvedValue(deviceDoc() as never);
		mockSecret.mockResolvedValue(secretDoc);
	});

	it('accepts the right PIN with no-store and logs the outcome without the PIN', async () => {
		const response = await POST(request({ pin: '482913' }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockLookup).toHaveBeenCalledTimes(1);
		expect(mockSecret).toHaveBeenCalledWith('kiosk-01');
		const logged = info.mock.calls.flat().join(' ');
		expect(logged).toContain('device=kiosk-01');
		expect(logged).toContain('result=ok');
		expect(logged).not.toContain('482913');
	});

	it('returns 401 with remaining attempts for a wrong PIN', async () => {
		const response = await POST(request({ pin: '111112' }));

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.remaining_attempts).toBe(4);
		expect(body.error.code).toBe('staff_pin_invalid');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('locks with 423 + retry_after_s on the 5th wrong PIN and rejects the right PIN while locked', async () => {
		for (let i = 0; i < 4; i += 1) {
			expect((await POST(request({ pin: '111112' }))).status).toBe(401);
		}
		const locked = await POST(request({ pin: '111112' }));
		expect(locked.status).toBe(423);
		expect((await locked.json()).retry_after_s).toBe(300);

		const stillLocked = await POST(request({ pin: '482913' }));
		expect(stillLocked.status).toBe(423);
	});

	it('returns 401 without remaining_attempts when device auth fails', async () => {
		const response = await POST(request({ pin: '482913' }, { 'x-device-secret': 'wrong' }));

		expect(response.status).toBe(401);
		const body = await response.json();
		expect(body.error.code).toBe('DEVICE_AUTH_FAILED');
		expect(body).not.toHaveProperty('remaining_attempts');
	});

	it('rejects inactive devices as an auth failure', async () => {
		mockLookup.mockResolvedValueOnce(deviceDoc({ status: 'inactive' }) as never);
		expect((await POST(request({ pin: '482913' }))).status).toBe(401);
	});

	it.each([
		['short pin', { pin: '4829' }],
		['letters', { pin: '48291a' }],
		['missing pin', {}],
		['extra field', { pin: '482913', device_id: 'other' }],
		['not json', 'nope']
	])('returns 400 for %s', async (_label, body) => {
		const response = await POST(request(body));
		expect(response.status).toBe(400);
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('returns 409 staff_pin_not_set when the device has no PIN doc (v1 or v2)', async () => {
		mockSecret.mockResolvedValueOnce(null);
		const response = await POST(request({ pin: '482913' }));
		expect(response.status).toBe(409);
		const body = await response.json();
		expect(body.error.code).toBe('staff_pin_not_set');
		expect(body.error.message).toBe('ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ');

		const v1: Record<string, unknown> = deviceDoc({ schema_v: 1 });
		delete v1.staff_pin_set;
		delete v1.staff_pin_is_default;
		delete v1.staff_pin_updated_at;
		delete v1.staff_pin_updated_by;
		mockLookup.mockResolvedValueOnce(v1 as never);
		mockSecret.mockResolvedValueOnce(null);
		expect((await POST(request({ pin: '482913' }))).status).toBe(409);
	});

	it('fails closed with 503 when the secrets store is unreachable', async () => {
		mockSecret.mockRejectedValueOnce(new StaffPinUnavailableError());
		const response = await POST(request({ pin: '482913' }));
		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(info.mock.calls.flat().join(' ')).toContain('result=unavailable');
	});

	it('returns 503 when the registry is down', async () => {
		mockLookup.mockRejectedValueOnce(new Error('couch down'));
		expect((await POST(request({ pin: '482913' }))).status).toBe(503);
	});
});
