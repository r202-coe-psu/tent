import { describe, it, expect } from 'vitest';
import {
	formatRoleList,
	canCancelHold,
	canAccessMedicalScreening,
	canAccessZoning,
	capabilitiesForShelter,
	compoundCapabilityRole,
	hasCapabilityInShelter,
	hasShelterScope,
	isAppSystemAdmin,
	isLastAppSystemAdmin,
	isShelterManager,
	isStaffOnly,
	isSystemAdmin,
	mergeShelterAssignment,
	parseCompoundCapability,
	roleDisplayLabel,
	rolesFromAssignments,
	assignmentsFromRoles,
	shelterCodeFromRoles,
	shelterCodesFromRoles,
	shelterScopeRole
} from './roles';

describe('roles kernel', () => {
	it('builds a shelter scope role from a code', () => {
		expect(shelterScopeRole('SH001')).toBe('shelter:SH001');
	});

	it('builds and parses compound capability roles', () => {
		expect(compoundCapabilityRole('SH001', 'registration_staff')).toBe('SH001:registration_staff');
		expect(parseCompoundCapability('SH001:medical_staff')).toEqual({
			code: 'SH001',
			capability: 'medical_staff'
		});
		expect(parseCompoundCapability('shelter:SH001')).toBeNull();
		expect(parseCompoundCapability('registration_staff')).toBeNull();
	});

	it('extracts shelter codes from a role list', () => {
		expect(shelterCodeFromRoles(['shelter:SH001', 'registration_staff'])).toBe('SH001');
		expect(
			shelterCodesFromRoles(['shelter:SH001', 'shelter:SH002', 'SH001:shelter_manager'])
		).toEqual(['SH001', 'SH002']);
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

	it('recognises shelter managers (legacy + compound)', () => {
		expect(isShelterManager(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'SH001:shelter_manager'])).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'SH001:shelter_manager'], 'SH001')).toBe(true);
		expect(isShelterManager(['shelter:SH001', 'SH001:shelter_manager'], 'SH002')).toBe(false);
		expect(isShelterManager(['shelter:SH001', 'registration_staff'])).toBe(false);
	});

	it('scopes capabilities per shelter without bleeding', () => {
		const roles = [
			'shelter:SH001',
			'shelter:SH002',
			'SH001:registration_staff',
			'SH002:medical_staff'
		];
		expect(hasCapabilityInShelter(roles, 'SH001', 'registration_staff')).toBe(true);
		expect(hasCapabilityInShelter(roles, 'SH001', 'medical_staff')).toBe(false);
		expect(hasCapabilityInShelter(roles, 'SH002', 'medical_staff')).toBe(true);
		expect(canAccessMedicalScreening(roles, 'SH001')).toBe(false);
		expect(canAccessMedicalScreening(roles, 'SH002')).toBe(true);
		expect(canAccessZoning(roles, 'SH001')).toBe(true);
		expect(canAccessZoning(roles, 'SH002')).toBe(false);
	});

	it('reads legacy flat capabilities for a single shelter', () => {
		expect(capabilitiesForShelter(['shelter:SH001', 'kitchen_staff'], 'SH001')).toEqual([
			'kitchen_staff'
		]);
		expect(hasShelterScope(['shelter:SH001', 'kitchen_staff'], 'SH001')).toBe(true);
	});

	it('builds and merges compound assignments', () => {
		expect(
			rolesFromAssignments([
				{ shelter_code: 'SH001', capabilities: ['registration_staff'] },
				{ shelter_code: 'SH002', capabilities: ['medical_staff', 'warehouse_staff'] }
			])
		).toEqual([
			'shelter:SH001',
			'SH001:registration_staff',
			'shelter:SH002',
			'SH002:medical_staff',
			'SH002:warehouse_staff'
		]);

		const merged = mergeShelterAssignment(['shelter:SH001', 'SH001:registration_staff'], 'SH002', [
			'medical_staff'
		]);
		expect(merged).toEqual([
			'shelter:SH001',
			'SH001:registration_staff',
			'shelter:SH002',
			'SH002:medical_staff'
		]);

		expect(mergeShelterAssignment(merged, 'SH001', [])).toEqual([
			'shelter:SH002',
			'SH002:medical_staff'
		]);
	});

	it('assignmentsFromRoles round-trips legacy and compound', () => {
		expect(assignmentsFromRoles(['shelter:SH001', 'registration_staff', 'triage_staff'])).toEqual([
			{ shelter_code: 'SH001', capabilities: ['registration_staff', 'triage_staff'] }
		]);
		expect(
			assignmentsFromRoles([
				'shelter:SH001',
				'shelter:SH002',
				'SH001:shelter_manager',
				'SH002:warehouse_staff'
			])
		).toEqual([
			{ shelter_code: 'SH001', capabilities: ['shelter_manager'] },
			{ shelter_code: 'SH002', capabilities: ['warehouse_staff'] }
		]);
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

	it('canAccessZoning allows registration_staff, facility_staff, shelter_manager, system_admin only', () => {
		expect(canAccessZoning(['system_admin'])).toBe(true);
		expect(canAccessZoning(['_admin'])).toBe(true);
		expect(canAccessZoning(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canAccessZoning(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(canAccessZoning(['shelter:SH001', 'facility_staff'])).toBe(true);
		expect(canAccessZoning(['shelter:SH001', 'medical_staff'])).toBe(false);
		expect(canAccessZoning(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canAccessZoning([])).toBe(false);
	});

	it('isStaffOnly accepts staff capabilities but rejects manager/system_admin', () => {
		expect(isStaffOnly(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'kitchen_staff', 'warehouse_staff'])).toBe(true);
		expect(
			isStaffOnly([
				'shelter:SH001',
				'shelter:SH002',
				'SH001:registration_staff',
				'SH002:medical_staff'
			])
		).toBe(true);
		expect(isStaffOnly(['shelter:SH001', 'shelter_manager'])).toBe(false);
		expect(isStaffOnly(['shelter:SH001', 'SH001:shelter_manager'])).toBe(false);
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

	it('renders compound capability with shelter code', () => {
		expect(roleDisplayLabel('SH001:registration_staff')).toBe('เจ้าหน้าที่ลงทะเบียน (SH001)');
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
	it('joins multi-shelter assignments one per line', () => {
		expect(
			formatRoleList([
				'shelter:SH001',
				'shelter:SH002',
				'SH001:registration_staff',
				'SH002:medical_staff'
			])
		).toBe('SH001:เจ้าหน้าที่ลงทะเบียน\nSH002:เจ้าหน้าที่การแพทย์และพยาบาล');
	});

	it('space-separates multiple capabilities within a shelter', () => {
		expect(
			formatRoleList(['shelter:SH001', 'SH001:registration_staff', 'SH001:shelter_manager'])
		).toBe('SH001:เจ้าหน้าที่ลงทะเบียน ผู้จัดการศูนย์');
	});

	it('joins legacy single-shelter roles', () => {
		expect(formatRoleList(['shelter:SH001', 'registration_staff'])).toBe(
			'SH001:เจ้าหน้าที่ลงทะเบียน'
		);
	});

	it('returns the default label for an empty/missing list', () => {
		expect(formatRoleList([])).toBe('ผู้ใช้ทั่วไป');
		expect(formatRoleList(undefined)).toBe('ผู้ใช้ทั่วไป');
	});
});
