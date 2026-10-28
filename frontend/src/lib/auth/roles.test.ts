import { describe, it, expect } from 'vitest';
import {
	formatRoleList,
	canCancelHold,
	canAccessUnassignedRegistrationQueue,
	canAccessDistributionDesk,
	canAccessMedicalScreening,
	canAccessVolunteerBackoffice,
	canAccessIncidents,
	canAccessZoning,
	canManageInShelters,
	hasCapabilityAnywhere,
	canManageScanners,
	canManageBanners,
	BANNER_MANAGER_CAPABILITIES,
	SCANNER_MANAGER_CAPABILITIES,
	canDistributeStock,
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
	DISTRIBUTION_STAFF,
	isKioskStaffOnly,
	kioskConfinement,
	KIOSK_STAFF,
	PR_STAFF,
	SA_GRANTABLE_CAPABILITIES,
	SHELTER_CAPABILITIES,
	STAFF_CAPABILITIES,
	shelterCodeFromRoles,
	shelterCodesFromRoles,
	shelterCodesWithCapability,
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
		// SH001 only has registration_staff — now admitted to Station 2 (decision sync 2026-10-10).
		expect(canAccessMedicalScreening(roles, 'SH001')).toBe(true);
		expect(canAccessMedicalScreening(roles, 'SH002')).toBe(true);
		expect(canAccessMedicalScreening(roles, 'SH003')).toBe(false);
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

	it('canAccessUnassignedRegistrationQueue mirrors hold-cancel desk gate for claim CTA', () => {
		expect(canAccessUnassignedRegistrationQueue(['system_admin'])).toBe(true);
		expect(canAccessUnassignedRegistrationQueue(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canAccessUnassignedRegistrationQueue(['shelter:SH001', 'registration_staff'])).toBe(
			true
		);
		expect(canAccessUnassignedRegistrationQueue(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canAccessUnassignedRegistrationQueue([])).toBe(false);
	});

	it('canAccessMedicalScreening allows registration_staff, medical_staff, triage_staff, shelter_manager, system_admin only', () => {
		expect(canAccessMedicalScreening(['system_admin'])).toBe(true);
		expect(canAccessMedicalScreening(['_admin'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'medical_staff'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'triage_staff'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'registration_staff'])).toBe(true);
		expect(canAccessMedicalScreening(['shelter:SH001', 'SH001:registration_staff'])).toBe(true);
		// REG of another shelter does not bleed into this one.
		expect(
			canAccessMedicalScreening(
				['shelter:SH001', 'shelter:SH002', 'SH001:registration_staff'],
				'SH002'
			)
		).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'facility_staff'])).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'volunteer_coordinator'])).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canAccessMedicalScreening(['shelter:SH001', 'warehouse_staff'])).toBe(false);
		expect(canAccessMedicalScreening([])).toBe(false);
	});

	it('canAccessVolunteerBackoffice allows volunteer_coordinator, shelter_manager, system_admin only', () => {
		expect(canAccessVolunteerBackoffice(['system_admin'])).toBe(true);
		expect(canAccessVolunteerBackoffice(['_admin'])).toBe(true);
		expect(canAccessVolunteerBackoffice(['shelter:SH001', 'shelter_manager'])).toBe(true);
		expect(canAccessVolunteerBackoffice(['shelter:SH001', 'volunteer_coordinator'])).toBe(true);
		expect(
			canAccessVolunteerBackoffice(['shelter:SH001', 'SH001:volunteer_coordinator'], 'SH001')
		).toBe(true);
		expect(canAccessVolunteerBackoffice(['shelter:SH001', 'registration_staff'])).toBe(false);
		expect(canAccessVolunteerBackoffice(['shelter:SH001', 'kitchen_staff'])).toBe(false);
		expect(canAccessVolunteerBackoffice(['shelter:SH001', 'security_officer'])).toBe(false);
		expect(canAccessVolunteerBackoffice([])).toBe(false);
	});

	it('canAccessVolunteerBackoffice is scoped to the selected shelter', () => {
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH001:volunteer_coordinator'];
		expect(canAccessVolunteerBackoffice(roles, 'SH001')).toBe(true);
		expect(canAccessVolunteerBackoffice(roles, 'SH002')).toBe(false);
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

	it('canAccessIncidents allows system_admin, security_officer, shelter_manager only', () => {
		expect(canAccessIncidents(['system_admin'], 'SH001')).toBe(true);
		expect(canAccessIncidents(['shelter:SH001', 'SH001:security_officer'], 'SH001')).toBe(true);
		expect(canAccessIncidents(['shelter:SH001', 'SH001:shelter_manager'], 'SH001')).toBe(true);
		expect(canAccessIncidents(['shelter:SH001', 'security_officer'], 'SH001')).toBe(true);
		expect(canAccessIncidents(['shelter:SH001', 'SH001:kitchen_staff'], 'SH001')).toBe(false);
		expect(canAccessIncidents(['shelter:SH001', 'SH001:registration_staff'])).toBe(false);
		expect(canAccessIncidents(['shelter:SH001', 'SH001:security_officer'])).toBe(true);
		expect(canAccessIncidents(['shelter:SH002', 'SH002:security_officer'], 'SH001')).toBe(false);
		expect(canAccessIncidents([])).toBe(false);
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

describe('distribution_staff capability', () => {
	it('is a grantable staff capability (SM, SA, and volunteer access pickers)', () => {
		expect(STAFF_CAPABILITIES).toContain(DISTRIBUTION_STAFF);
		expect(SHELTER_CAPABILITIES).toContain(DISTRIBUTION_STAFF);
		expect(SA_GRANTABLE_CAPABILITIES).toContain(DISTRIBUTION_STAFF);
		expect(isStaffOnly(['shelter:SH001', 'SH001:distribution_staff'])).toBe(true);
	});

	it('round-trips through compound shelter assignments', () => {
		const roles = rolesFromAssignments([
			{ shelter_code: 'SH001', capabilities: [DISTRIBUTION_STAFF] }
		]);
		expect(roles).toEqual(['shelter:SH001', 'SH001:distribution_staff']);
		expect(assignmentsFromRoles(roles)).toEqual([
			{ shelter_code: 'SH001', capabilities: [DISTRIBUTION_STAFF] }
		]);
	});

	it('is scoped to its own shelter', () => {
		const roles = ['shelter:SH001', 'shelter:SH002', 'SH001:distribution_staff'];
		expect(hasCapabilityInShelter(roles, 'SH001', DISTRIBUTION_STAFF)).toBe(true);
		expect(hasCapabilityInShelter(roles, 'SH002', DISTRIBUTION_STAFF)).toBe(false);
	});

	it('alone (with SA and SM) opens the Distribution Desk page (CR-161 R5)', () => {
		expect(canAccessDistributionDesk(['system_admin'], 'SH001')).toBe(true);
		for (const cap of ['shelter_manager', DISTRIBUTION_STAFF]) {
			expect(canAccessDistributionDesk(['shelter:SH001', `SH001:${cap}`], 'SH001')).toBe(true);
			expect(canAccessDistributionDesk(['shelter:SH001', `SH001:${cap}`], 'SH002')).toBe(false);
		}
		for (const cap of ['registration_staff', 'supply_coordinator', 'warehouse_staff']) {
			expect(canAccessDistributionDesk(['shelter:SH001', `SH001:${cap}`], 'SH001')).toBe(false);
		}
		// Legacy flat role with a single shelter scope (CR-161 R1).
		expect(canAccessDistributionDesk(['shelter:SH001', DISTRIBUTION_STAFF], 'SH001')).toBe(true);
	});

	it('has a Thai display label', () => {
		expect(roleDisplayLabel(DISTRIBUTION_STAFF)).toBe('เจ้าหน้าที่แจกจ่าย');
		expect(roleDisplayLabel('SH001:distribution_staff')).toBe('เจ้าหน้าที่แจกจ่าย (SH001)');
		expect(formatRoleList(['shelter:SH001', 'SH001:distribution_staff'])).toBe(
			'SH001:เจ้าหน้าที่แจกจ่าย'
		);
	});
});

describe('shelterCodesWithCapability', () => {
	it('returns null (every shelter) for a system admin', () => {
		expect(shelterCodesWithCapability(['system_admin'], ['shelter_manager'])).toBeNull();
	});

	it('lists the shelters where a compound shelter_manager holds the capability', () => {
		expect(
			shelterCodesWithCapability(['shelter:A', 'A:shelter_manager'], ['shelter_manager'])
		).toEqual(['A']);
		expect(
			shelterCodesWithCapability(
				['shelter:A', 'shelter:B', 'A:shelter_manager', 'B:shelter_manager'],
				['shelter_manager']
			)
		).toEqual(['A', 'B']);
	});

	it('honours the legacy flat role when the user has a single shelter scope', () => {
		expect(
			shelterCodesWithCapability(['shelter:A', 'shelter_manager'], ['shelter_manager'])
		).toEqual(['A']);
	});

	it('only lists the shelters where the capability is held (SM A + registration_staff B)', () => {
		expect(
			shelterCodesWithCapability(
				['shelter:A', 'shelter:B', 'A:shelter_manager', 'B:registration_staff'],
				['shelter_manager']
			)
		).toEqual(['A']);
	});

	it('does not count a compound capability without its shelter scope role', () => {
		expect(shelterCodesWithCapability(['A:shelter_manager'], ['shelter_manager'])).toEqual([]);
	});

	it('matches any of several capabilities', () => {
		const roles = ['shelter:A', 'shelter:B', 'A:shelter_manager', 'B:registration_staff'];
		expect(shelterCodesWithCapability(roles, ['shelter_manager', 'registration_staff'])).toEqual([
			'A',
			'B'
		]);
	});
});

describe('canManageInShelters', () => {
	it('is true for a system admin and false for an empty shelter list of a non-SA', () => {
		expect(canManageInShelters(['system_admin'], ['A', 'B'], ['shelter_manager'])).toBe(true);
		expect(canManageInShelters(['shelter:A', 'A:shelter_manager'], [], ['shelter_manager'])).toBe(
			false
		);
	});

	it('requires every shelter to be in scope', () => {
		const roles = ['shelter:A', 'shelter:B', 'A:shelter_manager', 'B:registration_staff'];
		expect(canManageInShelters(roles, ['A'], ['shelter_manager'])).toBe(true);
		expect(canManageInShelters(roles, ['A', 'B'], ['shelter_manager'])).toBe(false);
		expect(canManageInShelters(roles, ['A', 'B'], ['shelter_manager', 'registration_staff'])).toBe(
			true
		);
	});

	it('is false for a compound capability without its shelter scope role', () => {
		expect(canManageInShelters(['A:shelter_manager'], ['A'], ['shelter_manager'])).toBe(false);
	});

	it('accepts the legacy flat role for a single-shelter user', () => {
		expect(canManageInShelters(['shelter:A', 'shelter_manager'], ['A'], ['shelter_manager'])).toBe(
			true
		);
	});
});

describe('hasCapabilityAnywhere', () => {
	it('is true for SA or when held in at least one shelter, false otherwise', () => {
		expect(hasCapabilityAnywhere(['system_admin'], ['shelter_manager'])).toBe(true);
		expect(
			hasCapabilityAnywhere(
				['shelter:A', 'shelter:B', 'A:registration_staff', 'B:shelter_manager'],
				['shelter_manager']
			)
		).toBe(true);
		expect(hasCapabilityAnywhere(['shelter:A', 'A:registration_staff'], ['shelter_manager'])).toBe(
			false
		);
		expect(hasCapabilityAnywhere([], ['shelter_manager'])).toBe(false);
	});
});

describe('canManageScanners', () => {
	it('allows SA and the shelter_manager or kiosk_staff of that shelter only', () => {
		expect(SCANNER_MANAGER_CAPABILITIES).toEqual(['shelter_manager', 'kiosk_staff']);
		expect(canManageScanners(['system_admin'], 'A')).toBe(true);
		expect(canManageScanners(['shelter:A', 'A:shelter_manager'], 'A')).toBe(true);
		expect(canManageScanners(['shelter:A', 'A:shelter_manager'], 'B')).toBe(false);
		expect(canManageScanners(['shelter:A', 'A:kiosk_staff'], 'A')).toBe(true);
		expect(canManageScanners(['shelter:A', 'A:kiosk_staff'], 'B')).toBe(false);
		expect(canManageScanners(['shelter:A', 'A:registration_staff'], 'A')).toBe(false);
	});
});

describe('canManageBanners', () => {
	it('allows SA and the shelter_manager, kiosk_staff or pr_staff of that shelter only', () => {
		expect(BANNER_MANAGER_CAPABILITIES).toEqual(['shelter_manager', 'kiosk_staff', 'pr_staff']);
		expect(canManageBanners(['system_admin'], 'A')).toBe(true);
		expect(canManageBanners(['shelter:A', 'A:shelter_manager'], 'A')).toBe(true);
		expect(canManageBanners(['shelter:A', 'A:kiosk_staff'], 'A')).toBe(true);
		expect(canManageBanners(['shelter:A', 'A:pr_staff'], 'A')).toBe(true);
		expect(canManageBanners(['shelter:A', 'A:pr_staff'], 'B')).toBe(false);
		expect(canManageBanners(['shelter:A', 'A:registration_staff'], 'A')).toBe(false);
	});

	it('does not let pr_staff manage scanner devices', () => {
		expect(canManageScanners(['shelter:A', 'A:pr_staff'], 'A')).toBe(false);
	});
});

describe('canDistributeStock', () => {
	it('allows SA and the warehouse_staff or shelter_manager of that shelter only (#837)', () => {
		expect(canDistributeStock(['system_admin'], 'A')).toBe(true);
		expect(canDistributeStock(['shelter:A', 'A:warehouse_staff'], 'A')).toBe(true);
		expect(canDistributeStock(['shelter:A', 'A:shelter_manager'], 'A')).toBe(true);
		expect(canDistributeStock(['shelter:A', 'shelter_manager'], 'A')).toBe(true);
		expect(canDistributeStock(['shelter:A', 'A:shelter_manager'], 'B')).toBe(false);
		expect(canDistributeStock(['shelter:A', 'A:supply_coordinator'], 'A')).toBe(false);
		expect(canDistributeStock(['shelter:A', 'A:registration_staff'], 'A')).toBe(false);
	});
});

describe('kiosk_staff capability', () => {
	it('is a grantable staff capability', () => {
		expect(STAFF_CAPABILITIES).toContain(KIOSK_STAFF);
		expect(SHELTER_CAPABILITIES).toContain(KIOSK_STAFF);
		expect(SA_GRANTABLE_CAPABILITIES).toContain(KIOSK_STAFF);
		expect(roleDisplayLabel('SH001:kiosk_staff')).toContain('เจ้าหน้าที่ดูแลตู้ Kiosk');
	});

	it('round-trips through compound shelter assignments', () => {
		const roles = rolesFromAssignments([{ shelter_code: 'SH001', capabilities: [KIOSK_STAFF] }]);
		expect(roles).toEqual(['shelter:SH001', 'SH001:kiosk_staff']);
		expect(assignmentsFromRoles(roles)).toEqual([
			{ shelter_code: 'SH001', capabilities: [KIOSK_STAFF] }
		]);
	});
});

describe('pr_staff capability', () => {
	it('is a grantable staff capability with a Thai label', () => {
		expect(PR_STAFF).toBe('pr_staff');
		expect(STAFF_CAPABILITIES).toContain(PR_STAFF);
		expect(SHELTER_CAPABILITIES).toContain(PR_STAFF);
		expect(SA_GRANTABLE_CAPABILITIES).toContain(PR_STAFF);
		expect(roleDisplayLabel('SH001:pr_staff')).toContain('เจ้าหน้าที่ประชาสัมพันธ์');
	});

	it('round-trips through compound shelter assignments', () => {
		const roles = rolesFromAssignments([{ shelter_code: 'SH001', capabilities: [PR_STAFF] }]);
		expect(roles).toEqual(['shelter:SH001', 'SH001:pr_staff']);
		expect(assignmentsFromRoles(roles)).toEqual([
			{ shelter_code: 'SH001', capabilities: [PR_STAFF] }
		]);
	});
});

describe('kioskConfinement', () => {
	it("is 'banners' when pr_staff is the only capability", () => {
		expect(kioskConfinement(['shelter:A', 'A:pr_staff'], 'A')).toBe('banners');
		expect(kioskConfinement(['shelter:A', 'A:pr_staff'], null)).toBe('banners');
	});

	it("is 'devices' when kiosk_staff is the only capability", () => {
		expect(kioskConfinement(['shelter:A', 'A:kiosk_staff'], 'A')).toBe('devices');
	});

	it("is 'devices' when the user holds kiosk_staff and pr_staff", () => {
		expect(kioskConfinement(['shelter:A', 'A:kiosk_staff', 'A:pr_staff'], 'A')).toBe('devices');
	});

	it('is null once the user holds another capability alongside pr_staff', () => {
		expect(kioskConfinement(['shelter:A', 'A:pr_staff', 'A:registration_staff'], 'A')).toBeNull();
		expect(kioskConfinement(['shelter:A', 'A:pr_staff', 'A:shelter_manager'], 'A')).toBeNull();
	});

	it('scopes to the selected shelter', () => {
		const roles = ['shelter:A', 'shelter:B', 'A:pr_staff', 'B:registration_staff'];
		expect(kioskConfinement(roles, 'A')).toBe('banners');
		expect(kioskConfinement(roles, 'B')).toBeNull();
		expect(kioskConfinement(roles, null)).toBeNull();
	});

	it('is null for SA and for users without capabilities', () => {
		expect(kioskConfinement(['system_admin'], 'A')).toBeNull();
		expect(kioskConfinement(['shelter:A'], 'A')).toBeNull();
		expect(kioskConfinement([], null)).toBeNull();
	});

	it('treats pr_staff as confined for isKioskStaffOnly too', () => {
		expect(isKioskStaffOnly(['shelter:A', 'A:pr_staff'], 'A')).toBe(true);
		expect(isKioskStaffOnly(['shelter:A', 'A:pr_staff', 'A:registration_staff'], 'A')).toBe(false);
	});
});

describe('isKioskStaffOnly', () => {
	it('is true when kiosk_staff is the only capability in the shelter', () => {
		expect(isKioskStaffOnly(['shelter:A', 'A:kiosk_staff'], 'A')).toBe(true);
		expect(isKioskStaffOnly(['shelter:A', 'A:kiosk_staff'], null)).toBe(true);
	});

	it('is false once the user holds another capability in that shelter', () => {
		expect(isKioskStaffOnly(['shelter:A', 'A:kiosk_staff', 'A:registration_staff'], 'A')).toBe(
			false
		);
		expect(isKioskStaffOnly(['shelter:A', 'A:shelter_manager'], 'A')).toBe(false);
	});

	it('scopes to the active shelter', () => {
		const roles = ['shelter:A', 'shelter:B', 'A:kiosk_staff', 'B:shelter_manager'];
		expect(isKioskStaffOnly(roles, 'A')).toBe(true);
		expect(isKioskStaffOnly(roles, 'B')).toBe(false);
		expect(isKioskStaffOnly(roles, null)).toBe(false);
	});

	it('is false for SA and for users without capabilities', () => {
		expect(isKioskStaffOnly(['system_admin'], 'A')).toBe(false);
		expect(isKioskStaffOnly(['shelter:A'], 'A')).toBe(false);
		expect(isKioskStaffOnly([], null)).toBe(false);
	});
});
