import { describe, it, expect } from 'vitest';
import {
	assertCanGrant,
	isProtectedBootstrapAdmin,
	ServiceError,
	serviceError,
	serviceErrorFromCouch,
	type Caller
} from './couch-admin';

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

	it('Couch _admin may not grant system_admin', () => {
		expect(grantError(couchAdmin, ['system_admin'])?.code).toBe('FORBIDDEN');
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

	it('rejects more than one shelter scope (1 user 1 shelter)', () => {
		expect(grantError(sa, ['shelter:SH001', 'shelter:SH002'])?.code).toBe('VALIDATION');
	});

	it('a manager may grant own-shelter staff', () => {
		expect(grantError(mgr, ['shelter:SH001', 'registration_staff'])).toBeNull();
		expect(grantError(mgr, ['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBeNull();
	});

	it('a manager may not cross shelters', () => {
		expect(grantError(mgr, ['shelter:SH002', 'registration_staff'])?.code).toBe('FORBIDDEN');
	});

	it('a manager may not grant manager or system_admin', () => {
		expect(grantError(mgr, ['shelter:SH001', 'shelter_manager'])?.code).toBe('FORBIDDEN');
		expect(grantError(mgr, ['shelter:SH001', 'system_admin'])?.code).toBe('FORBIDDEN');
	});

	it('a manager without a shelter scope is forbidden', () => {
		const noScope: Caller = {
			name: 'x',
			roles: ['shelter_manager'],
			isSA: false,
			shelterCode: null
		};
		expect(grantError(noScope, ['registration_staff'])?.code).toBe('FORBIDDEN');
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
