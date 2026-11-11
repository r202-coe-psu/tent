import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { FASTAPI_INTERNAL_URL: 'http://fastapi:9000', EXTERNAL_API_SECRET: 'svc-secret' }
}));
vi.mock('$app/server', () => ({
	getRequestEvent: () => {
		throw new Error('no request');
	}
}));

const { IntegrationError, getIntegrationStatus, integrationRequest, mapM5State } =
	await import('./integrations');

const fetchMock = vi.fn();

beforeEach(() => {
	vi.stubGlobal('fetch', fetchMock);
	fetchMock.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

const jsonResponse = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json' }
	});

describe('integrationRequest', () => {
	it('calls FastAPI with the service secret and returns the body', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { ok: 1 }));
		await expect(integrationRequest('POST', '/v1/integrations/m5/sync', { a: 1 })).resolves.toEqual(
			{
				ok: 1
			}
		);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://fastapi:9000/v1/integrations/m5/sync');
		expect(init.headers.Authorization).toBe('Bearer svc-secret');
		expect(init.body).toBe('{"a":1}');
	});

	it('maps a network failure to 503 CENTRAL_UNAVAILABLE', async () => {
		fetchMock.mockRejectedValue(new TypeError('fetch failed'));
		await expect(integrationRequest('GET', '/v1/integrations/status')).rejects.toMatchObject({
			status: 503,
			code: 'CENTRAL_UNAVAILABLE'
		});
	});

	it('unwraps the FastAPI error envelope with its extra fields', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(409, {
				errors: [{ code: 'CANCEL_NEEDS_MOPH', message: 'อนุมัติแล้ว', status: 'pending' }]
			})
		);
		const err = await integrationRequest('POST', '/x').catch((e: unknown) => e);
		expect(err).toBeInstanceOf(IntegrationError);
		expect(err).toMatchObject({
			status: 409,
			code: 'CANCEL_NEEDS_MOPH',
			message: 'อนุมัติแล้ว',
			extra: { status: 'pending' }
		});
	});

	it('reports a FastAPI 5xx as 503', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(503, { errors: [{ code: 'M5_UNAVAILABLE', message: 'down' }] })
		);
		await expect(integrationRequest('GET', '/x')).rejects.toMatchObject({
			status: 503,
			code: 'M5_UNAVAILABLE'
		});
	});
});

describe('integration status gate (CR §2)', () => {
	it.each([
		[
			{ configured: false, token_ok: false, reachable: false, error: 'not_configured' },
			'm5_not_configured'
		],
		[
			{ configured: true, token_ok: false, reachable: true, error: 'credential_invalid' },
			'm5_credential_invalid'
		],
		[
			{ configured: true, token_ok: false, reachable: false, error: 'unavailable' },
			'm5_unavailable'
		],
		[{ configured: true, token_ok: true, reachable: true, error: null }, 'ready']
	] as const)('maps %o to %s', (m5, state) => {
		expect(mapM5State(m5)).toBe(state);
	});

	it('reports central_unreachable when FastAPI does not answer', async () => {
		fetchMock.mockRejectedValue(new DOMException('timeout', 'TimeoutError'));
		await expect(getIntegrationStatus()).resolves.toEqual({
			m5: { state: 'central_unreachable', checked_at: null }
		});
	});

	it('passes the FastAPI check time through', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(200, {
				m5: { configured: true, token_ok: true, reachable: true, checked_at: 't', error: null }
			})
		);
		await expect(getIntegrationStatus()).resolves.toEqual({
			m5: { state: 'ready', checked_at: 't' }
		});
	});
});
