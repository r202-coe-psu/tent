/**
 * Role kernel — the canonical CouchDB role vocabulary (docs/prd/role-permission-matrix.md §1.1,
 * docs/data/data-model.md §6, CR-104). Pure + isomorphic: shared by the server BFF (authorization) and the
 * client (forms, nav). No I/O, no Svelte.
 *
 * `_users.roles` is either `["system_admin"]` (global) or `["shelter:{code}", <capability>...]`
 * (one or more shelter scopes + capability roles). `shelter_manager` subsumes the staff capabilities.
 */

/** App-level system administrator (global; no `shelter:` scope). */
export const SYSTEM_ADMIN = 'system_admin';

/** Per-shelter manager — may run any staff function in their own shelter. */
export const SHELTER_MANAGER = 'shelter_manager';

export const WAREHOUSE_STAFF = 'warehouse_staff';
export const SUPPLY_COORDINATOR = 'supply_coordinator';
export const TRIAGE_STAFF = 'triage_staff';
export const MEDICAL_STAFF = 'medical_staff';
export const VOLUNTEER_COORDINATOR = 'volunteer_coordinator';
export const SECURITY_OFFICER = 'security_officer';
export const FACILITY_STAFF = 'facility_staff';

/** Capability roles a shelter_manager or coordinator is allowed to grant (per CR-104 §2.1). */
export const STAFF_CAPABILITIES = [
	'registration_staff',
	TRIAGE_STAFF,
	MEDICAL_STAFF,
	'kitchen_staff',
	SUPPLY_COORDINATOR,
	WAREHOUSE_STAFF,
	VOLUNTEER_COORDINATOR,
	SECURITY_OFFICER,
	FACILITY_STAFF
] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/** Every capability an SA may grant alongside the shelter scope. */
export const SHELTER_CAPABILITIES = [...STAFF_CAPABILITIES, SHELTER_MANAGER] as const;
export type ShelterCapability = (typeof SHELTER_CAPABILITIES)[number];

/** Roles an SA may pick in the portal user form (shelter capabilities + system_admin). */
export const SA_GRANTABLE_CAPABILITIES = [...SHELTER_CAPABILITIES, SYSTEM_ADMIN] as const;
export type SaGrantableCapability = (typeof SA_GRANTABLE_CAPABILITIES)[number];

/** The CouchDB server-admin role — never mintable through the app. */
export const COUCH_ADMIN = '_admin';

/** Shelter-scope role string for a shelter code, e.g. `SH001` → `shelter:SH001`. */
export function shelterScopeRole(code: string): string {
	return `shelter:${code}`;
}

/** Extract all shelter codes from a role list (`["shelter:SH001", "shelter:SH002"]` → `["SH001", "SH002"]`). */
export function shelterCodesFromRoles(roles: readonly string[]): string[] {
	return roles.filter((r) => r.startsWith('shelter:')).map((r) => r.slice('shelter:'.length));
}

/** Extract the single shelter code from a role list (`shelter:SH001` → `SH001`), or null. */
export function shelterCodeFromRoles(roles: readonly string[]): string | null {
	const codes = shelterCodesFromRoles(roles);
	return codes.length > 0 ? codes[0] : null;
}

/** True when the role list denotes an SA or the CouchDB server admin (SA-equivalent). */
export function isSystemAdmin(roles: readonly string[]): boolean {
	return roles.includes(SYSTEM_ADMIN) || roles.includes(COUCH_ADMIN);
}

/** True when the role list holds the app `system_admin` RoleKey (not Couch `_admin`). */
export function isAppSystemAdmin(roles: readonly string[]): boolean {
	return roles.includes(SYSTEM_ADMIN);
}

/**
 * True when removing/demoting this target would leave zero app SAs.
 * `appSaCountIncludingTarget` is the current count of `_users` with `system_admin`.
 */
export function isLastAppSystemAdmin(
	targetRoles: readonly string[],
	appSaCountIncludingTarget: number
): boolean {
	return isAppSystemAdmin(targetRoles) && appSaCountIncludingTarget <= 1;
}

/** True when the role list denotes a shelter_manager. */
export function isShelterManager(roles: readonly string[]): boolean {
	return roles.includes(SHELTER_MANAGER);
}

/**
 * True when the actor may cancel a pre-registration hold (D-HOLD-CANCEL / CR-070):
 * system_admin, shelter_manager, or registration_staff.
 */
export function canCancelHold(roles: readonly string[]): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles) ||
		hasStaffCapability(roles, 'registration_staff')
	);
}

/**
 * True when the actor may access the Station 2 medical screening route / queue:
 * system_admin, shelter_manager, medical_staff, or triage_staff.
 */
export function canAccessMedicalScreening(roles: readonly string[]): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles) ||
		hasStaffCapability(roles, MEDICAL_STAFF) ||
		hasStaffCapability(roles, TRIAGE_STAFF)
	);
}

/** True when the role list includes `warehouse_staff` or `supply_coordinator`. */
export function isWarehouseStaff(roles: readonly string[]): boolean {
	return roles.includes(WAREHOUSE_STAFF) || roles.includes(SUPPLY_COORDINATOR);
}

/** True when the roles hold a given staff capability (e.g. `kitchen_staff`). */
export function hasStaffCapability(roles: readonly string[], cap: StaffCapability): boolean {
	return roles.includes(cap);
}

/**
 * True when every non-shelter capability in the list is a staff capability
 * (no `shelter_manager`/`system_admin`/`_admin`). A shelter_manager may only
 * create or delete staff — this is that predicate.
 */
export function isStaffOnly(roles: readonly string[]): boolean {
	const staff = STAFF_CAPABILITIES as readonly string[];
	return roles.filter((r) => !r.startsWith('shelter:')).every((c) => staff.includes(c));
}

/**
 * Per-role Thai display labels for the staff capability set. Kept in one
 * place so adding a new capability in `STAFF_CAPABILITIES` surfaces here at
 * the type level (TypeScript will flag a missing entry below). Stored RoleKey
 * values stay English; only UI copy is Thai.
 */
const STAFF_CAPABILITY_LABELS: Record<StaffCapability, string> = {
	registration_staff: 'เจ้าหน้าที่ลงทะเบียน',
	triage_staff: 'เจ้าหน้าที่คัดกรอง',
	medical_staff: 'เจ้าหน้าที่การแพทย์และพยาบาล',
	kitchen_staff: 'เจ้าหน้าที่ครัว',
	supply_coordinator: 'ผู้ประสานงานพัสดุและคลัง',
	warehouse_staff: 'เจ้าหน้าที่คลัง',
	volunteer_coordinator: 'ผู้ประสานงานจิตอาสา',
	security_officer: 'เจ้าหน้าที่รักษาความปลอดภัย',
	facility_staff: 'เจ้าหน้าที่ฝ่ายอาคารสถานที่'
};

/**
 * Human-readable Thai label for a single CouchDB role string. Shelter-scope
 * roles render as `ศูนย์ SH001`. Unknown values fall back to the raw role
 * string so the UI never goes blank.
 */
export function roleDisplayLabel(role: string): string {
	if (role === SYSTEM_ADMIN) return 'ผู้ดูแลระบบ';
	if (role === SHELTER_MANAGER) return 'ผู้จัดการศูนย์';
	if (role === COUCH_ADMIN) return 'ผู้ดูแล CouchDB';
	if (role.startsWith('shelter:')) {
		return `ศูนย์ ${role.slice('shelter:'.length)}`;
	}
	if ((STAFF_CAPABILITIES as readonly string[]).includes(role)) {
		return STAFF_CAPABILITY_LABELS[role as StaffCapability];
	}
	return role;
}

/**
 * Join a role list into a single human-readable string. Returns `'ผู้ใช้ทั่วไป'`
 * for an empty list — used as the avatar tooltip in the back-office navbar
 * when the user has no assigned roles.
 */
export function formatRoleList(roles: readonly string[] | undefined): string {
	if (!roles || roles.length === 0) return 'ผู้ใช้ทั่วไป';
	return roles.map(roleDisplayLabel).join(', ');
}
