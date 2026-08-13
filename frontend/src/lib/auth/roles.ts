/**
 * Role kernel — the canonical CouchDB role vocabulary (docs/prd/role-permission-matrix.md §1.1,
 * docs/data/data-model.md §6). Pure + isomorphic: shared by the server BFF (authorization) and the
 * client (forms, nav). No I/O, no Svelte.
 *
 * `_users.roles` is either `["system_admin"]` (global) or `["shelter:{code}", <capability>...]`
 * (one shelter scope + capability roles). `shelter_manager` subsumes the staff capabilities.
 */

/** App-level system administrator (global; no `shelter:` scope). */
export const SYSTEM_ADMIN = 'system_admin';

/** Per-shelter manager — may run any staff function in their own shelter. */
export const SHELTER_MANAGER = 'shelter_manager';

export const WAREHOUSE_STAFF = 'warehouse_staff';

/** Capability roles a shelter_manager is allowed to grant (per spec §1.1). */
export const STAFF_CAPABILITIES = ['registration_staff', 'kitchen_staff', WAREHOUSE_STAFF] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/** Every capability an SA may grant alongside the shelter scope. */
export const SHELTER_CAPABILITIES = [...STAFF_CAPABILITIES, SHELTER_MANAGER] as const;
export type ShelterCapability = (typeof SHELTER_CAPABILITIES)[number];

/** The CouchDB server-admin role — never mintable through the app. */
export const COUCH_ADMIN = '_admin';

/** Shelter-scope role string for a shelter code, e.g. `SH001` → `shelter:SH001`. */
export function shelterScopeRole(code: string): string {
	return `shelter:${code}`;
}

/** Extract the single shelter code from a role list (`shelter:SH001` → `SH001`), or null. */
export function shelterCodeFromRoles(roles: readonly string[]): string | null {
	const scope = roles.find((r) => r.startsWith('shelter:'));
	return scope ? scope.slice('shelter:'.length) : null;
}

/** True when the role list denotes an SA or the CouchDB server admin (SA-equivalent). */
export function isSystemAdmin(roles: readonly string[]): boolean {
	return roles.includes(SYSTEM_ADMIN) || roles.includes(COUCH_ADMIN);
}

/** True when the role list denotes a shelter_manager. */
export function isShelterManager(roles: readonly string[]): boolean {
	return roles.includes(SHELTER_MANAGER);
}

/** True when the role list includes `warehouse_staff`. */
export function isWarehouseStaff(roles: readonly string[]): boolean {
	return roles.includes(WAREHOUSE_STAFF);
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
	kitchen_staff: 'เจ้าหน้าที่ครัว',
	warehouse_staff: 'เจ้าหน้าที่คลัง'
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
