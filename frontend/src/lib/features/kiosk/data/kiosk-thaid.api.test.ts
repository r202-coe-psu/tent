import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	cancelKioskThaidSession,
	createKioskThaidSession,
	getKioskThaidSessionStatus,
	KioskThaidError
} from './kiosk-thaid.api';

const SESSION_ID = '0123456789abcdef0123456789abcdef';

function stubFetch(response: Response) {
	const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(response);
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
	return new Response(JSON.stringify(body), {
		...init,
		headers: { 'content-type': 'application/json', ...init.headers }
	});
}

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
});

describe('createKioskThaidSession', () => {
	it('makes an uncached same-origin POST without a body and maps the reply', async () => {
		const fetchMock = stubFetch(
			jsonResponse({
				session_id: SESSION_ID,
				qr_url: 'https://tent.example.go.th/api/v1/auth/oauth/thaid/start?session_id=abc',
				expires_at: 1_780_000_000_000,
				expires_in_sec: 180
			})
		);

		await expect(createKioskThaidSession()).resolves.toEqual({
			sessionId: SESSION_ID,
			qrUrl: 'https://tent.example.go.th/api/v1/auth/oauth/thaid/start?session_id=abc',
			expiresAt: 1_780_000_000_000,
			expiresInSec: 180
		});
		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/scanner/kiosk/thaid/session');
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(init?.body).toBeUndefined();
	});
});

describe('createKioskThaidSession errors', () => {
	it.each([
		[403, 'disabled', { error: { code: 'KIOSK_METHOD_DISABLED' } }],
		[429, 'rate_limited', { error: { code: 'KIOSK_RATE_LIMITED' } }],
		[401, 'unauthorized', { error: { code: 'DEVICE_AUTH_FAILED' } }],
		[400, 'invalid', { error: { code: 'INVALID_INPUT' } }],
		[408, 'unavailable', { error: { code: 'REQUEST_TIMEOUT' } }],
		[503, 'unavailable', { error: { code: 'DEPENDENCY_UNAVAILABLE' } }]
	])('maps HTTP %i to a KioskThaidError of kind %s', async (status, kind, body) => {
		stubFetch(jsonResponse(body, { status, headers: { 'retry-after': '30' } }));

		const error = await createKioskThaidSession().catch((caught: unknown) => caught);

		expect(error).toBeInstanceOf(KioskThaidError);
		expect(error).toMatchObject({
			name: 'KioskThaidError',
			status,
			code: body.error.code,
			kind
		});
		if (status === 429) expect(error).toMatchObject({ retryAfterSeconds: 30 });
	});

	it('converts a ten-second timeout into a retryable unavailable error', async () => {
		vi.useFakeTimers();
		vi.stubGlobal(
			'fetch',
			vi.fn(
				(_input: RequestInfo | URL, init?: RequestInit) =>
					new Promise<Response>((_resolve, reject) => {
						init?.signal?.addEventListener('abort', () =>
							reject(new DOMException('aborted', 'AbortError'))
						);
					})
			)
		);

		const pending = createKioskThaidSession().catch((caught: unknown) => caught);
		await vi.advanceTimersByTimeAsync(10_000);

		expect(await pending).toMatchObject({ status: 0, code: 'TIMEOUT', kind: 'unavailable' });
	});
});

describe('getKioskThaidSessionStatus', () => {
	it('POSTs the session id and returns the status with its expiry', async () => {
		const fetchMock = stubFetch(
			jsonResponse({ status: 'completed', expires_at: 1_780_000_000_000, expires_in_sec: 42 })
		);

		await expect(getKioskThaidSessionStatus(SESSION_ID)).resolves.toEqual({
			status: 'completed',
			expiresAt: 1_780_000_000_000,
			expiresInSec: 42
		});
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/scanner/kiosk/thaid/session/status');
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(JSON.parse(String(init?.body))).toEqual({ session_id: SESSION_ID });
	});

	it('treats a 404 as an expired session', async () => {
		stubFetch(jsonResponse({ status: 'expired' }, { status: 404 }));

		await expect(getKioskThaidSessionStatus(SESSION_ID)).resolves.toEqual({ status: 'expired' });
	});

	it('rejects an unrecognised status so the caller keeps polling instead of guessing', async () => {
		stubFetch(jsonResponse({ status: 'weird', expires_at: 1 }));

		await expect(getKioskThaidSessionStatus(SESSION_ID)).rejects.toMatchObject({
			name: 'KioskThaidError',
			kind: 'unavailable'
		});
	});

	it('maps a 400 invalid-input reply to a KioskThaidError', async () => {
		stubFetch(jsonResponse({ error: { code: 'INVALID_INPUT' } }, { status: 400 }));

		await expect(getKioskThaidSessionStatus(SESSION_ID)).rejects.toMatchObject({
			status: 400,
			code: 'INVALID_INPUT',
			kind: 'invalid'
		});
	});
});

describe('cancelKioskThaidSession', () => {
	it('POSTs the session id to the cancel endpoint', async () => {
		const fetchMock = stubFetch(jsonResponse({ ok: true }));

		await cancelKioskThaidSession(SESSION_ID);

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('/api/v1/scanner/kiosk/thaid/session/cancel');
		expect(init).toMatchObject({ method: 'POST', cache: 'no-store' });
		expect(JSON.parse(String(init?.body))).toEqual({ session_id: SESSION_ID });
	});

	it('never throws, so leaving the page cannot fail on a network error', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

		await expect(cancelKioskThaidSession(SESSION_ID)).resolves.toBeUndefined();
	});
});
