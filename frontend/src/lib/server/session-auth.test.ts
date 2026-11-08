import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { COUCHDB_ADMIN_URL: 'http://admin:secret@couchdb.test:5984/' }
}));
import {
	ServiceError,
	centralCouchBase,
	readSessionUserCtx,
	requireShelterScopeOrSA,
	serviceErrorStatus
} from './session-auth';
import * as couchAdmin from './couch-admin';

const fetchMock = vi.fn();

function whoami(userCtx: { name: string | null; roles: string[] } | null) {
	fetchMock.mockResolvedValueOnce({ json: async () => (userCtx ? { userCtx } : null) });
}

beforeEach(() => vi.stubGlobal('fetch', fetchMock));
afterEach(() => {
	fetchMock.mockReset();
	vi.unstubAllGlobals();
});

describe('centralCouchBase', () => {
	it('keeps scheme + host and discards the admin credentials', () => {
		expect(centralCouchBase()).toBe('http://couchdb.test:5984');
	});
});

describe('readSessionUserCtx', () => {
	it('forwards only the caller cookie to central _session, never admin credentials', async () => {
		whoami({ name: 'amy', roles: ['shelter:SH001'] });

		const ctx = await readSessionUserCtx('AuthSession=abc');

		expect(ctx).toEqual({ name: 'amy', roles: ['shelter:SH001'] });
		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toBe('http://couchdb.test:5984/_session');
		expect(init.headers).toEqual({ Accept: 'application/json', Cookie: 'AuthSession=abc' });
	});

	it('is anonymous when CouchDB returns no userCtx', async () => {
		whoami(null);
		expect(await readSessionUserCtx(null)).toEqual({ name: null, roles: [] });
	});
});

describe('requireShelterScopeOrSA', () => {
	it('rejects an anonymous session with 401', async () => {
		whoami({ name: null, roles: [] });
		await expect(requireShelterScopeOrSA(null, 'SH001')).rejects.toMatchObject({ status: 401 });
	});

	it('lets a system admin into any shelter', async () => {
		whoami({ name: 'sa', roles: ['system_admin'] });
		await expect(requireShelterScopeOrSA('c', 'SH999')).resolves.toMatchObject({ isSA: true });
	});

	it('rejects a user outside the shelter scope with 403', async () => {
		whoami({ name: 'bob', roles: ['shelter:SH002'] });
		await expect(requireShelterScopeOrSA('c', 'SH001')).rejects.toMatchObject({ status: 403 });
	});

	it('only resolves the caller when no shelter code is given', async () => {
		whoami({ name: 'bob', roles: ['shelter:SH002'] });
		await expect(requireShelterScopeOrSA('c')).resolves.toMatchObject({
			name: 'bob',
			shelterCode: 'SH002'
		});
	});
});

describe('ServiceError', () => {
	it('maps its code to an HTTP status', () => {
		expect(serviceErrorStatus(new ServiceError('CONFLICT', 'x').code)).toBe(409);
	});
});

describe('couch-admin re-exports (existing callers keep working)', () => {
	it('exposes the very same helpers', () => {
		expect(couchAdmin.ServiceError).toBe(ServiceError);
		expect(couchAdmin.readSessionUserCtx).toBe(readSessionUserCtx);
		expect(couchAdmin.requireShelterScopeOrSA).toBe(requireShelterScopeOrSA);
		expect(couchAdmin.centralCouchBase).toBe(centralCouchBase);
	});
});
