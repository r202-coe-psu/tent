import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: { COUCHDB_ADMIN_URL: 'http://admin:password@couchdb.test' }
}));
import {
	activeManagerShelter,
	assertCanGrant,
	authorizeUserWrite,
	isProtectedBootstrapAdmin,
	requireSystemAdmin,
	ServiceError,
	serviceError,
	serviceErrorFromCouch,
	serviceOrHttpError,
	type Caller
} from './couch-admin';
import { error } from '@sveltejs/kit';

const sa: Caller = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };
const couchAdmin: Caller = { name: 'admin', roles: ['_admin'], isSA: true, shelterCode: null };
const mgr: Caller = {
	name: 'mgr',
	roles: ['shelter:SH001', 'shelter_manager'],
	isSA: false,
	shelterCode: 'SH001'
};

function grantError(caller: Caller, roles: string[]): ServiceError | null {
	try {
		assertCanGrant(caller, roles);
		return null;
	} catch (e) {
		return e instanceof ServiceError ? e : null;
	}
}

describe('assertCanGrant', () => {
	it('SA may grant staff, managers, and any shelter', () => {
		expect(grantError(sa, ['shelter:SH009', 'registration_staff'])).toBeNull();
		expect(grantError(sa, ['shelter:SH002', 'shelter_manager'])).toBeNull();
	});

	it('an app SA may grant exactly system_admin', () => {
		expect(grantError(sa, ['system_admin'])).toBeNull();
	});

	it('Couch _admin may grant exactly system_admin (SA-equivalent)', () => {
		expect(grantError(couchAdmin, ['system_admin'])).toBeNull();
	});

	it('rejects system_admin mixed with a shelter scope', () => {
		expect(grantError(sa, ['system_admin', 'shelter:SH001'])?.code).toBe('VALIDATION');
		expect(grantError(sa, ['shelter:SH001', 'system_admin', 'registration_staff'])?.code).toBe(
			'VALIDATION'
		);
	});

	it('nobody may grant the CouchDB server admin role', () => {
		expect(grantError(sa, ['_admin'])?.code).toBe('FORBIDDEN');
		expect(grantError(mgr, ['shelter:SH001', '_admin'])?.code).toBe('FORBIDDEN');
	});

	it('SA may grant multi-shelter compound roles', () => {
		expect(
			grantError(sa, [
				'shelter:SH001',
				'shelter:SH002',
				'SH001:shelter_manager',
				'SH002:registration_staff'
			])
		).toBeNull();
	});

	it('rejects empty shelter scope for non-SA grants', () => {
		expect(grantError(sa, ['registration_staff'])?.code).toBe('VALIDATION');
	});

	it('a manager may grant own-shelter staff', () => {
		expect(grantError(mgr, ['shelter:SH001', 'registration_staff'])).toBeNull();
		expect(
			grantError(mgr, ['shelter:SH001', 'SH001:kitchen_staff', 'SH001:warehouse_staff'])
		).toBeNull();
	});

	it('a manager may not cross shelters', () => {
		expect(grantError(mgr, ['shelter:SH002', 'registration_staff'])?.code).toBe('FORBIDDEN');
	});

	it('a manager may not grant manager or system_admin', () => {
		expect(grantError(mgr, ['shelter:SH001', 'shelter_manager'])?.code).toBe('FORBIDDEN');
		expect(grantError(mgr, ['shelter:SH001', 'system_admin'])?.code).toBe('FORBIDDEN');
	});

	// Manages SH001 and SH002, working in SH002 (#477).
	const multi = (working: string): Caller => ({
		name: 'multi',
		roles: ['shelter:SH001', 'SH001:shelter_manager', 'shelter:SH002', 'SH002:shelter_manager'],
		isSA: false,
		shelterCode: working
	});

	it('a multi-shelter manager grants in the shelter they work in, not the first (#477)', () => {
		expect(grantError(multi('SH002'), ['shelter:SH002', 'registration_staff'])).toBeNull();
		expect(grantError(multi('SH001'), ['shelter:SH001', 'registration_staff'])).toBeNull();
	});

	it('a multi-shelter manager may not grant in a managed shelter they are not working in (#477)', () => {
		expect(grantError(multi('SH002'), ['shelter:SH001', 'registration_staff'])?.code).toBe(
			'FORBIDDEN'
		);
		expect(
			grantError(multi('SH002'), [
				'shelter:SH001',
				'shelter:SH002',
				'SH001:kitchen_staff',
				'SH002:kitchen_staff'
			])?.code
		).toBe('FORBIDDEN');
	});

	it('a manager without a shelter scope is forbidden', () => {
		const noScope: Caller = {
			name: 'x',
			roles: ['shelter_manager'],
			isSA: false,
			shelterCode: null
		};
		expect(grantError(noScope, ['registration_staff'])?.code).toBe('VALIDATION');
	});
});

describe('requireSystemAdmin', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it.each([
		['app system admin', ['system_admin']],
		['CouchDB server admin', ['_admin']]
	])('accepts %s', async (_label, roles) => {
		fetchMock.mockResolvedValue({
			json: async () => ({ userCtx: { name: 'operator', roles } })
		});

		await expect(requireSystemAdmin('session=operator')).resolves.toMatchObject({
			name: 'operator',
			roles,
			isSA: true
		});
		expect(fetchMock).toHaveBeenCalledWith(
			'http://couchdb.test/_session',
			expect.objectContaining({ headers: expect.objectContaining({ Cookie: 'session=operator' }) })
		);
	});

	it('rejects a scoped staff session', async () => {
		fetchMock.mockResolvedValue({
			json: async () => ({
				userCtx: { name: 'staff', roles: ['shelter:SH001', 'registration_staff'] }
			})
		});

		await expect(requireSystemAdmin('session=staff')).rejects.toMatchObject({ status: 403 });
	});
});

describe('isProtectedBootstrapAdmin', () => {
	it('matches the bootstrap username even without _admin', () => {
		expect(isProtectedBootstrapAdmin({ name: 'admin', roles: [] }, 'admin')).toBe(true);
	});

	it('matches any user holding the CouchDB _admin role', () => {
		expect(isProtectedBootstrapAdmin({ name: 'ops', roles: ['_admin'] }, 'admin')).toBe(true);
	});

	it('does not match a regular app SA', () => {
		expect(isProtectedBootstrapAdmin({ name: 'sa01', roles: ['system_admin'] }, 'admin')).toBe(
			false
		);
	});
});

describe('serviceErrorFromCouch', () => {
	it('explains missing system database', () => {
		const err = serviceErrorFromCouch('create user', 404, {
			error: 'not_found',
			reason: 'Database does not exist.'
		});
		expect(err.code).toBe('INTERNAL');
		expect(err.message).toBe('Could not create user');
		expect(err.description).toMatch(/couchdb-init|_cluster_setup|_users/i);
	});

	it('explains admin auth rejection', () => {
		const err = serviceErrorFromCouch('list users', 401, {
			error: 'unauthorized',
			reason: 'Name or password is incorrect.'
		});
		expect(err.description).toMatch(/COUCHDB_ADMIN_URL/);
	});

	it('includes status and CouchDB detail for other failures', () => {
		const err = serviceErrorFromCouch('create user', 400, {
			error: 'bad_request',
			reason: 'Invalid name'
		});
		expect(err.description).toBe('CouchDB responded 400: bad_request: Invalid name');
	});
});

describe('serviceError envelope', () => {
	it('includes optional description in the JSON body', async () => {
		const res = serviceError(
			new ServiceError('INTERNAL', 'Could not create user', 'CouchDB database missing')
		);
		expect(res.status).toBe(500);
		await expect(res.json()).resolves.toEqual({
			error: {
				code: 'INTERNAL',
				message: 'Could not create user',
				description: 'CouchDB database missing'
			}
		});
	});
});

describe('authorizeUserWrite (generic /api/v1/users gate)', () => {
	afterEach(() => vi.unstubAllGlobals());

	async function asRoles(roles: string[], requestedShelter?: string | null) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ userCtx: { name: 'u', roles } }))
		);
		return authorizeUserWrite('AuthSession=x', requestedShelter);
	}

	it('refuses a volunteer_coordinator: grants go through /api/v1/volunteer-access (#955)', async () => {
		await expect(asRoles(['shelter:SH001', 'SH001:volunteer_coordinator'])).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
	});

	it('still lets a shelter manager through', async () => {
		await expect(asRoles(['shelter:SH001', 'SH001:shelter_manager'])).resolves.toMatchObject({
			name: 'u'
		});
	});
});

describe('authorizeUserWrite active shelter (#477)', () => {
	afterEach(() => vi.unstubAllGlobals());

	const both = ['shelter:SH001', 'SH001:shelter_manager', 'shelter:SH002', 'SH002:shelter_manager'];
	// Manager in SH002, only a registration desk in SH001.
	const managerInSh002Only = [
		'shelter:SH001',
		'SH001:registration_staff',
		'shelter:SH002',
		'SH002:shelter_manager'
	];

	async function asRoles(roles: string[], requested: string | null | undefined) {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ userCtx: { name: 'u', roles } }))
		);
		return authorizeUserWrite('AuthSession=x', requested);
	}

	it('returns the requested shelter as the caller shelterCode', async () => {
		await expect(asRoles(both, 'SH002')).resolves.toMatchObject({ shelterCode: 'SH002' });
		await expect(asRoles(managerInSh002Only, 'SH002')).resolves.toMatchObject({
			shelterCode: 'SH002'
		});
	});

	it('refuses a shelter where the caller is not a manager (403), even if they belong to it', async () => {
		await expect(asRoles(managerInSh002Only, 'SH001')).rejects.toMatchObject({
			code: 'FORBIDDEN'
		});
		await expect(asRoles(both, 'SH009')).rejects.toMatchObject({ code: 'FORBIDDEN' });
	});

	it('asks a manager of several shelters to name one (VALIDATION → 422)', async () => {
		await expect(asRoles(both, null)).rejects.toMatchObject({ code: 'VALIDATION' });
	});

	it('defaults a manager of one shelter to it', async () => {
		await expect(asRoles(['shelter:SH001', 'SH001:shelter_manager'], null)).resolves.toMatchObject({
			shelterCode: 'SH001'
		});
	});

	it('defaults to the one managed shelter even when the caller is staff elsewhere (CR FR-3)', async () => {
		await expect(asRoles(managerInSh002Only, null)).resolves.toMatchObject({
			shelterCode: 'SH002'
		});
		await expect(asRoles(managerInSh002Only, '  ')).resolves.toMatchObject({
			shelterCode: 'SH002'
		});
	});

	it('refuses a manager with no managed shelter as FORBIDDEN, not VALIDATION', async () => {
		await expect(asRoles(['shelter_manager'], null)).rejects.toMatchObject({
			code: 'FORBIDDEN',
			message: 'Manager has no shelter scope'
		});
	});

	it('leaves SA unrestricted', async () => {
		await expect(asRoles(['system_admin'], null)).resolves.toMatchObject({ isSA: true });
		await expect(asRoles(['system_admin'], 'SH009')).resolves.toMatchObject({
			shelterCode: 'SH009'
		});
	});

	it('only gates when the route names no shelter (undefined)', async () => {
		await expect(asRoles(both, undefined)).resolves.toMatchObject({ name: 'u' });
	});
});

describe('activeManagerShelter (#477)', () => {
	const roles = [
		'shelter:SH001',
		'SH001:shelter_manager',
		'shelter:SH002',
		'SH002:shelter_manager'
	];
	const caller = (shelterCode: string | null, r: string[] = roles): Caller => ({
		name: 'm',
		roles: r,
		isSA: false,
		shelterCode
	});

	it('keeps the resolved shelter when the caller manages it', () => {
		expect(activeManagerShelter(caller('SH002'))).toBe('SH002');
	});

	it('never returns a shelter the caller does not manage', () => {
		expect(activeManagerShelter(caller('SH009'))).toBe('SH001');
		const staffInSh001 = [
			'shelter:SH001',
			'SH001:registration_staff',
			'shelter:SH002',
			'SH002:shelter_manager'
		];
		expect(activeManagerShelter(caller('SH001', staffInSh001))).toBe('SH002');
	});

	it('falls back to the caller scope when no shelter is managed', () => {
		expect(activeManagerShelter(caller('SH003', ['shelter:SH003', 'shelter_manager']))).toBe(
			'SH003'
		);
		expect(activeManagerShelter(caller(null, []))).toBeNull();
	});
});

describe('serviceOrHttpError', () => {
	function thrown(fn: () => never): unknown {
		try {
			fn();
		} catch (e) {
			return e;
		}
	}

	it.each([
		[400, 'VALIDATION'],
		[401, 'UNAUTHENTICATED'],
		[403, 'FORBIDDEN'],
		[404, 'NOT_FOUND']
	] as const)(
		'keeps a SvelteKit %i and wraps it in the contract envelope',
		async (status, code) => {
			const res = serviceOrHttpError(thrown(() => error(status, 'เหตุผล')));
			expect(res.status).toBe(status);
			expect(await res.json()).toEqual({ error: { code, message: 'เหตุผล' } });
		}
	);

	it('defers to serviceError for everything else', async () => {
		const res = serviceOrHttpError(new ServiceError('CONFLICT', 'ชน'));
		expect(res.status).toBe(409);
		expect(await res.json()).toEqual({ error: { code: 'CONFLICT', message: 'ชน' } });
		expect(serviceOrHttpError(new Error('x')).status).toBe(500);
	});
});
