import { describe, it, expect } from 'vitest';
import {
	isShelterManager,
	isStaffOnly,
	isSystemAdmin,
	shelterCodeFromRoles,
	shelterScopeRole
} from './roles';

describe('roles kernel', () => {
	it('builds a shelter scope role from a code', () => {
		expect(shelterScopeRole('SH001')).toBe('shelter:SH001');
	});

	it('extracts the shelter code from a role list', () => {
		expect(shelterCodeFromRoles(['shelter:SH001', 'volunteer'])).toBe('SH001');
		expect(shelterCodeFromRoles(['system_admin'])).toBeNull();
	});

	it('recognises system admins (system_admin or the CouchDB _admin)', () => {
		expect(isSystemAdmin(['system_admin'])).toBe(true);
		expect(isSystemAdmin(['_admin'])).toBe(true);
		expect(isSystemAdmin(['shelter:SH001', 'shelter_manager'])).toBe(false);
	});

	it('recognises shelter managers', () => {
		expect(isShelterManager(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'volunteer'])).toBe(false);
	});

	it('isStaffOnly accepts staff capabilities but rejects manager/system_admin', () => {
		expect(isStaffOnly(['shelter:SH001', 'volunteer'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'shelter_manager'])).toBe(false);
		expect(isStaffOnly(['shelter:SH001', 'system_admin'])).toBe(false);
	});
});
