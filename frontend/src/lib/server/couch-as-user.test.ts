import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { COUCHDB_ADMIN_URL: 'http://admin:adminpw@couchdb.test:5984' }
}));

import { ServiceError, serviceError } from './couch-admin';
import { userRaw } from './couch-as-user';

function jsonResponse(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

async function caught(promise: Promise<unknown>): Promise<unknown> {
	try {
		await promise;
	} catch (e) {
		return e;
	}
	throw new Error('expected the promise to reject');
}

describe('userRaw', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('forwards only the AuthSession cookie and passes a 201 through', async () => {
		fetchMock.mockResolvedValue(jsonResponse(201, { ok: true, id: 'job:1', rev: '1-a' }));

		const res = await userRaw(
			'theme=dark; AuthSession=abc.def==; _ga=GA1.2; other=1',
			'/printing/job%3A1',
			'PUT',
			{ type: 'print_job' }
		);

		expect(res).toEqual({ status: 201, data: { ok: true, id: 'job:1', rev: '1-a' } });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://couchdb.test:5984/printing/job%3A1');
		expect(init.method).toBe('PUT');
		expect(init.headers.Cookie).toBe('AuthSession=abc.def==');
		expect(init.body).toBe('{"type":"print_job"}');
	});

	it('never sends admin credentials or an Authorization header', async () => {
		fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

		await userRaw('AuthSession=abc', '/printing/job%3A1', 'GET');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).not.toContain('admin');
		expect(url).not.toContain('@');
		expect(Object.keys(init.headers).map((h) => h.toLowerCase())).not.toContain('authorization');
		expect(JSON.stringify(init)).not.toContain('adminpw');
	});

	it.each([
		['null', null],
		['empty', ''],
		['no AuthSession among others', 'theme=dark; _ga=1'],
		['empty AuthSession value', 'AuthSession=; theme=dark'],
		['a lookalike cookie name', 'XAuthSession=abc; AuthSessionX=def']
	])('throws UNAUTHENTICATED before any fetch when the cookie is %s', async (_label, cookie) => {
		const e = await caught(userRaw(cookie, '/printing/job%3A1', 'GET'));

		expect(e).toBeInstanceOf(ServiceError);
		expect((e as ServiceError).code).toBe('UNAUTHENTICATED');
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('maps a CouchDB 401 to UNAUTHENTICATED', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(401, { error: 'unauthorized', reason: 'Authentication required.' })
		);

		const e = await caught(userRaw('AuthSession=expired', '/printing/job%3A1', 'GET'));

		expect(e).toBeInstanceOf(ServiceError);
		expect((e as ServiceError).code).toBe('UNAUTHENTICATED');
	});

	it('maps a CouchDB 403 to FORBIDDEN, keeping the reason for logs but not for clients', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse(403, { error: 'forbidden', reason: 'source shelter_code mismatch' })
		);

		const e = (await caught(
			userRaw('AuthSession=abc', '/printing/job%3A1', 'PUT', { type: 'print_job' })
		)) as ServiceError & { couchReason?: string };

		expect(e).toBeInstanceOf(ServiceError);
		expect(e.code).toBe('FORBIDDEN');
		expect(e.couchReason).toBe('source shelter_code mismatch');
		const clientBody = await serviceError(e).text();
		expect(clientBody).not.toContain('shelter_code mismatch');
	});

	it('returns other statuses to the caller as-is', async () => {
		fetchMock.mockResolvedValue(jsonResponse(404, { error: 'not_found', reason: 'missing' }));

		const res = await userRaw('AuthSession=abc', '/printing/job%3A1', 'GET');

		expect(res).toEqual({ status: 404, data: { error: 'not_found', reason: 'missing' } });
	});
});
