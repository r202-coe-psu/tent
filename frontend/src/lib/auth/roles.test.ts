import { describe, it, expect } from 'vitest';
import {
	formatRoleList,
	isShelterManager,
	isStaffOnly,
	isSystemAdmin,
	roleDisplayLabel,
	shelterCodeFromRoles,
	shelterScopeRole
} from './roles';

describe('roles kernel', () => {
	it('builds a shelter scope role from a code', () => {
		expect(shelterScopeRole('SH001')).toBe('shelter:SH001');
	});

	it('extracts the shelter code from a role list', () => {
		expect(shelterCodeFromRoles(['shelter:SH001', 'registration_staff'])).toBe('SH001');
		expect(shelterCodeFromRoles(['system_admin'])).toBeNull();
	});

	it('recognises system admins (system_admin or the CouchDB _admin)', () => {
		expect(isSystemAdmin(['system_admin'])).toBe(true);
		expect(isSystemAdmin(['_admin'])).toBe(true);
		expect(isSystemAdmin(['shelter:SH001', 'shelter_manager'])).toBe(false);
	});

	it('recognises shelter managers', () => {
		expect(isShelterManager(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'registration_staff'])).toBe(false);
	});

	it('isStaffOnly accepts staff capabilities but rejects manager/system_admin', () => {
		expect(isStaffOnly(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'shelter_manager'])).toBe(false);
		expect(isStaffOnly(['shelter:SH001', 'system_admin'])).toBe(false);
	});
});

describe('roleDisplayLabel', () => {
	it('maps every internal RoleKey to an English label', () => {
		expect(roleDisplayLabel('system_admin')).toBe('System Admin');
		expect(roleDisplayLabel('shelter_manager')).toBe('Shelter Manager');
		expect(roleDisplayLabel('registration_staff')).toBe('Registration Staff');
		expect(roleDisplayLabel('kitchen_staff')).toBe('Kitchen Staff');
		expect(roleDisplayLabel('warehouse_staff')).toBe('Warehouse Staff');
	});

	it('renders a shelter-scope role with its code', () => {
		expect(roleDisplayLabel('shelter:SH001')).toBe('Shelter Staff (SH001)');
	});

	it('falls back to the raw role string for unknown values', () => {
		expect(roleDisplayLabel('volunteer')).toBe('volunteer');
		expect(roleDisplayLabel('something_new')).toBe('something_new');
	});

	it('does not treat the legacy "volunteer" string as a staff capability', () => {
		// CR-002: volunteer is a domain concept / affiliation tag, not a RoleKey.
		expect(roleDisplayLabel('volunteer')).not.toBe('Volunteer');
	});
});

describe('formatRoleList', () => {
	it('joins multiple roles with ", "', () => {
		expect(formatRoleList(['shelter:SH001', 'registration_staff'])).toBe(
			'Shelter Staff (SH001), Registration Staff'
		);
	});

	it('returns the default label for an empty/missing list', () => {
		expect(formatRoleList([])).toBe('General User');
		expect(formatRoleList(undefined)).toBe('General User');
	});
});
