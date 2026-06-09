import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { COUCH_URL, couchFetch, getSession, sessionLogin, sessionLogout } from './couch';

type MockResponse = {
	ok: boolean;
	status: number;
	json: () => Promise<unknown>;
};

function mockResponse(body: unknown, { ok = true, status = 200 } = {}): MockResponse {
	return {
		ok,
		status,
		json: () => Promise.resolve(body)
	};
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
	fetchMock = vi.fn();
	vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('COUCH_URL', () => {
	it('strips embedded credentials', () => {
		expect(COUCH_URL).not.toContain('admin:password@');
		expect(COUCH_URL).not.toContain('@');
		expect(COUCH_URL).toMatch(/^https?:\/\/[^@]+$/);
	});
});

describe('couchFetch', () => {
	it('sends credentials and JSON headers, and prefixes COUCH_URL', async () => {
		fetchMock.mockResolvedValue(mockResponse({ ok: true }));

		await couchFetch('/_session');

		expect(fetchMock).toHaveBeenCalledTimes(1);
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${COUCH_URL}/_session`);
		expect(init.credentials).toBe('include');
		expect(init.headers['Content-Type']).toBe('application/json');
		expect(init.headers.Accept).toBe('application/json');
	});

	it('returns parsed JSON on ok response', async () => {
		fetchMock.mockResolvedValue(mockResponse({ hello: 'world' }));

		const result = await couchFetch<{ hello: string }>('/foo');
		expect(result).toEqual({ hello: 'world' });
	});

	it('throws with CouchDB reason on non-ok response', async () => {
		fetchMock.mockResolvedValue(
			mockResponse(
				{ ok: false, error: 'unauthorized', reason: 'Name or password is incorrect.' },
				{ ok: false, status: 401 }
			)
		);

		await expect(couchFetch('/_session', { method: 'POST' })).rejects.toThrow(
			'Name or password is incorrect.'
		);
	});

	it('falls back to error when reason is absent', async () => {
		fetchMock.mockResolvedValue(
			mockResponse({ ok: false, error: 'unauthorized' }, { ok: false, status: 401 })
		);

		await expect(couchFetch('/_session')).rejects.toThrow('unauthorized');
	});

	it('falls back to a generic message when reason and error are absent', async () => {
		fetchMock.mockResolvedValue(mockResponse({ ok: false }, { ok: false, status: 500 }));

		await expect(couchFetch('/_session')).rejects.toThrow('CouchDB request failed (500)');
	});
});

describe('sessionLogin', () => {
	it('POSTs credentials to /_session and returns { name, roles }', async () => {
		fetchMock.mockResolvedValue(mockResponse({ ok: true, name: 'demo', roles: [] }));

		const result = await sessionLogin({ name: 'demo', password: 'secret' });

		expect(result).toEqual({ name: 'demo', roles: [] });

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${COUCH_URL}/_session`);
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body)).toEqual({ name: 'demo', password: 'secret' });
	});

	it('propagates an error when login fails with 401', async () => {
		fetchMock.mockResolvedValue(
			mockResponse(
				{ ok: false, error: 'unauthorized', reason: 'Name or password is incorrect.' },
				{ ok: false, status: 401 }
			)
		);

		await expect(sessionLogin({ name: 'demo', password: 'wrong' })).rejects.toThrow(
			'Name or password is incorrect.'
		);
	});
});

describe('sessionLogout', () => {
	it('sends DELETE to /_session', async () => {
		fetchMock.mockResolvedValue(mockResponse({ ok: true }));

		await sessionLogout();

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe(`${COUCH_URL}/_session`);
		expect(init.method).toBe('DELETE');
	});
});

describe('getSession', () => {
	it('returns { name, roles } when userCtx.name is set', async () => {
		fetchMock.mockResolvedValue(
			mockResponse({ ok: true, userCtx: { name: 'demo', roles: ['x'] } })
		);

		const result = await getSession();
		expect(result).toEqual({ name: 'demo', roles: ['x'] });
	});

	it('returns null when userCtx.name is null', async () => {
		fetchMock.mockResolvedValue(
			mockResponse({ ok: true, userCtx: { name: null, roles: [] } })
		);

		expect(await getSession()).toBeNull();
	});
});
