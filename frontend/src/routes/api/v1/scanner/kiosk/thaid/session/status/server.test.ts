import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import {
	_resetSessionsForTest,
	completeKioskSession,
	createKioskCheckInSession
} from '$lib/server/thaid-scan-session';

vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);

function event(body: unknown, deviceId = 'kiosk-a', secret = 'test-secret'): RequestEvent {
	return {
		request: new Request('http://localhost/api/v1/scanner/kiosk/thaid/session/status', {
			method: 'POST',
			headers: {
				...(deviceId ? { 'x-device-id': deviceId } : {}),
				...(secret ? { 'x-device-secret': secret } : {}),
				'content-type': 'application/json'
			},
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

describe('POST /api/v1/scanner/kiosk/thaid/session/status', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		_resetSessionsForTest();
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return { registry_id: deviceId, shelter_code: 'SH001' } as never;
		});
	});

	it('returns 401 DEVICE_AUTH_FAILED without device credentials', async () => {
		const response = await POST(event({ session_id: 'a'.repeat(32) }, ''));

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
	});

	it('returns 400 INVALID_INPUT for a malformed session_id', async () => {
		for (const body of [{}, { session_id: 'nope' }, { session_id: 'A'.repeat(32) }]) {
			const response = await POST(event(body));

			expect(response.status).toBe(400);
			expect((await response.json()).error.code).toBe('INVALID_INPUT');
			expect(response.headers.get('cache-control')).toBe('no-store');
		}
	});

	it('returns only status, expires_at and expires_in_sec for the owning device', async () => {
		const session = createKioskCheckInSession({ device_id: 'kiosk-a', shelter_code: 'SH001' });

		const response = await POST(event({ session_id: session.id }));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			status: 'pending',
			expires_at: session.expiresAt,
			expires_in_sec: 300
		});
	});

	it('leaks no citizen data once the session is completed', async () => {
		const session = createKioskCheckInSession({ device_id: 'kiosk-a', shelter_code: 'SH001' });
		completeKioskSession(session.id, { pid: '1234567890123', sub: 'sub-1' });

		const response = await POST(event({ session_id: session.id }));

		expect(response.status).toBe(200);
		const text = await response.text();
		expect(Object.keys(JSON.parse(text)).sort()).toEqual([
			'expires_at',
			'expires_in_sec',
			'status'
		]);
		expect(JSON.parse(text).expires_in_sec).toBe(180);
		expect(JSON.parse(text).status).toBe('completed');
		expect(text).not.toContain('1234567890123');
		expect(text).not.toContain('sub-1');
	});

	it('answers 404 expired for another device, a missing session and an expired one alike', async () => {
		const session = createKioskCheckInSession({ device_id: 'kiosk-a', shelter_code: 'SH001' });
		const stale = createKioskCheckInSession({ device_id: 'kiosk-b', shelter_code: 'SH001' });
		vi.useFakeTimers();
		vi.setSystemTime(stale.expiresAt + 1000);
		const expired = await POST(event({ session_id: stale.id }, 'kiosk-b'));
		vi.useRealTimers();
		expect(expired.status).toBe(404);
		expect(await expired.json()).toEqual({ status: 'expired' });

		const otherDevice = await POST(event({ session_id: session.id }, 'kiosk-b'));
		const missing = await POST(event({ session_id: 'b'.repeat(32) }));

		expect(otherDevice.status).toBe(404);
		expect(await otherDevice.json()).toEqual({ status: 'expired' });
		expect(missing.status).toBe(404);
		expect(await missing.json()).toEqual({ status: 'expired' });
		expect(otherDevice.headers.get('cache-control')).toBe('no-store');
	});
});
