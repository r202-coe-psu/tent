import { describe, it, expect } from 'vitest';
import { assertCanGrant, ServiceError, type Caller } from './couch-admin';

const sa: Caller = { name: 'sa', roles: ['system_admin'], isSA: true, shelterCode: null };
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
		expect(grantError(sa, ['shelter:SH009', 'volunteer'])).toBeNull();
		expect(grantError(sa, ['shelter:SH002', 'shelter_manager'])).toBeNull();
	});

	it('nobody may grant the CouchDB server admin role', () => {
		expect(grantError(sa, ['_admin'])?.code).toBe('FORBIDDEN');
		expect(grantError(mgr, ['shelter:SH001', '_admin'])?.code).toBe('FORBIDDEN');
	});

	it('rejects more than one shelter scope (1 user 1 shelter)', () => {
		expect(grantError(sa, ['shelter:SH001', 'shelter:SH002'])?.code).toBe('VALIDATION');
	});

	it('a manager may grant own-shelter staff', () => {
		expect(grantError(mgr, ['shelter:SH001', 'volunteer'])).toBeNull();
		expect(grantError(mgr, ['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBeNull();
	});

	it('a manager may not cross shelters', () => {
		expect(grantError(mgr, ['shelter:SH002', 'volunteer'])?.code).toBe('FORBIDDEN');
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
		expect(grantError(noScope, ['volunteer'])?.code).toBe('FORBIDDEN');
	});
});
