import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import {
	_resetSessionsForTest,
	createKioskCheckInSession,
	getKioskSessionForDevice
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
		request: new Request('http://localhost/api/v1/scanner/kiosk/thaid/session/cancel', {
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

describe('POST /api/v1/scanner/kiosk/thaid/session/cancel', () => {
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
		const response = await POST(event({ session_id: 'nope' }));

		expect(response.status).toBe(400);
		expect((await response.json()).error.code).toBe('INVALID_INPUT');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it("cancels the owning device's session and answers { ok: true }, also when repeated", async () => {
		const session = createKioskCheckInSession({ device_id: 'kiosk-a', shelter_code: 'SH001' });

		const first = await POST(event({ session_id: session.id }));
		const second = await POST(event({ session_id: session.id }));

		expect(first.status).toBe(200);
		expect(await first.json()).toEqual({ ok: true });
		expect(first.headers.get('cache-control')).toBe('no-store');
		expect(second.status).toBe(200);
		expect(await second.json()).toEqual({ ok: true });
		expect(getKioskSessionForDevice(session.id, 'kiosk-a')?.status).toBe('cancelled');
	});

	it("answers { ok: true } but leaves another device's session untouched", async () => {
		const session = createKioskCheckInSession({ device_id: 'kiosk-a', shelter_code: 'SH001' });

		const response = await POST(event({ session_id: session.id }, 'kiosk-b'));
		const unknown = await POST(event({ session_id: 'c'.repeat(32) }));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ ok: true });
		expect(unknown.status).toBe(200);
		expect(getKioskSessionForDevice(session.id, 'kiosk-a')?.status).toBe('pending');
	});
});
