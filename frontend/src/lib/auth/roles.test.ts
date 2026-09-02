import { describe, it, expect } from 'vitest';
import {
	formatRoleList,
	canCancelHold,
	canAccessMedicalScreening,
	isAppSystemAdmin,
	isLastAppSystemAdmin,
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

	it('isAppSystemAdmin is only the app RoleKey, not Couch _admin', () => {
		expect(isAppSystemAdmin(['system_admin'])).toBe(true);
		expect(isAppSystemAdmin(['_admin'])).toBe(false);
		expect(isAppSystemAdmin(['shelter:SH001', 'shelter_manager'])).toBe(false);
	});

	it('isLastAppSystemAdmin when the target is the only app SA', () => {
		expect(isLastAppSystemAdmin(['system_admin'], 1)).toBe(true);
		expect(isLastAppSystemAdmin(['system_admin'], 2)).toBe(false);
		expect(isLastAppSystemAdmin(['shelter:SH001', 'registration_staff'], 1)).toBe(false);
		expect(isLastAppSystemAdmin(['_admin'], 0)).toBe(false);
	});

	it('recognises shelter managers', () => {
		expect(isShelterManager(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'registration_staff'])).toBe(false);
	});

	it('canCancelHold allows SA, SM, and registration_staff only', () => {
		expect(canCancelHold(['system_admin'])).toBe(true);
		expect(canCancelHold(['_admin'])).toBe(true);
		expect(canCancelHold(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canCancelHold(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(canCancelHold(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canCancelHold(['shelter:SH001', 'warehouse_staff'])).toBe(false);
		expect(canCancelHold([])).toBe(false);
	});

	it('canAccessMedicalScreening allows medical_staff, triage_staff, shelter_manager, system_admin only', () => {
		expect(canAccessMedicalScreening(['system_admin'])).toBe(true);
		expect(canAccessMedicalScreening(['_admin'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'medical_staff'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'triage_staff'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'registration_staff'])).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'warehouse_staff'])).toBe(false);
		expect(canAccessMedicalScreening([])).toBe(false);
	});

	it('isStaffOnly accepts staff capabilities but rejects manager/system_admin', () => {
		expect(isStaffOnly(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'shelter_manager'])).toBe(false);
		expect(isStaffOnly(['shelter:SH001', 'system_admin'])).toBe(false);
	});
});

describe('roleDisplayLabel', () => {
	it('maps every internal RoleKey to a Thai label', () => {
		expect(roleDisplayLabel('system_admin')).toBe('ผู้ดูแลระบบ');
		expect(roleDisplayLabel('shelter_manager')).toBe('ผู้จัดการศูนย์');
		expect(roleDisplayLabel('registration_staff')).toBe('เจ้าหน้าที่ลงทะเบียน');
		expect(roleDisplayLabel('kitchen_staff')).toBe('เจ้าหน้าที่ครัว');
		expect(roleDisplayLabel('warehouse_staff')).toBe('เจ้าหน้าที่คลัง');
	});

	it('renders a shelter-scope role with its code', () => {
		expect(roleDisplayLabel('shelter:SH001')).toBe('ศูนย์ SH001');
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
			'ศูนย์ SH001, เจ้าหน้าที่ลงทะเบียน'
		);
	});

	it('returns the default label for an empty/missing list', () => {
		expect(formatRoleList([])).toBe('ผู้ใช้ทั่วไป');
		expect(formatRoleList(undefined)).toBe('ผู้ใช้ทั่วไป');
	});
});
