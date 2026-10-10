import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { isKioskThaidCheckInAllowed } from '$lib/features/kiosk/server/kiosk-thaid-gate.server';
import { _resetSessionsForTest, getKioskSessionForDevice } from '$lib/server/thaid-scan-session';

vi.mock('$lib/features/kiosk/server/kiosk-thaid-gate.server', () => ({
	isKioskThaidCheckInAllowed: vi.fn()
}));

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockGate = vi.mocked(isKioskThaidCheckInAllowed);

function event(deviceId = 'kiosk-a', secret = 'test-secret'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/thaid/session', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				...(secret ? { 'x-device-secret': secret } : {})
			}
		}),
		url: new URL('http://localhost/api/v1/scanner/kiosk/thaid/session')
	} as unknown as RequestEvent;
}

describe('POST /api/v1/scanner/kiosk/thaid/session', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetSessionsForTest();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return { registry_id: deviceId, shelter_code: 'SH001' } as never;
		});
		mockGate.mockResolvedValue(true);
	});

	it('returns 401 DEVICE_AUTH_FAILED without device credentials', async () => {
		const response = await POST(event(''));

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('returns 403 KIOSK_METHOD_DISABLED and creates no session when the gate is closed', async () => {
		mockGate.mockResolvedValueOnce(false);

		const response = await POST(event('kiosk-gate'));

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: {
				code: 'KIOSK_METHOD_DISABLED',
				message: 'ช่องทางนี้ปิดใช้งาน กรุณาติดต่อเจ้าหน้าที่'
			}
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockGate).toHaveBeenCalledWith('SH001');
	});

	it('creates a session and returns its id, QR url and Unix-ms expiry', async () => {
		const before = Date.now();

		const response = await POST(event('kiosk-create'));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = await response.json();
		expect(Object.keys(body).sort()).toEqual(['expires_at', 'qr_url', 'session_id']);
		expect(body.session_id).toMatch(/^[0-9a-f]{32}$/);
		expect(body.qr_url).toBe(
			`http://localhost/api/v1/auth/oauth/thaid/start?mode=kiosk_check_in&session_id=${body.session_id}`
		);
		expect(body.expires_at).toBeGreaterThanOrEqual(before + 300_000);
		expect(body.expires_at).toBeLessThanOrEqual(Date.now() + 300_000);
	});

	it("cancels the same device's previous pending session when a new one is created", async () => {
		const first = await (await POST(event('kiosk-twice'))).json();
		const second = await (await POST(event('kiosk-twice'))).json();

		expect(getKioskSessionForDevice(first.session_id, 'kiosk-twice')?.status).toBe('cancelled');
		expect(getKioskSessionForDevice(second.session_id, 'kiosk-twice')?.status).toBe('pending');
	});

	it('returns 429 KIOSK_RATE_LIMITED on the 11th create within a minute for one device', async () => {
		for (let i = 0; i < 10; i += 1) {
			expect((await POST(event('kiosk-limited'))).status).toBe(200);
		}

		const response = await POST(event('kiosk-limited'));

		expect(response.status).toBe(429);
		expect(await response.json()).toEqual({
			error: { code: 'KIOSK_RATE_LIMITED', message: 'กรุณารอสักครู่แล้วลองใหม่' }
		});
		expect(response.headers.get('retry-after')).toBe('60');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await POST(event('kiosk-other'))).status).toBe(200);
	});
});
