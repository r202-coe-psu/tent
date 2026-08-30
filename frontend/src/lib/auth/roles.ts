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
export const REGISTRATION_STAFF = 'registration_staff';
export const KITCHEN_STAFF = 'kitchen_staff';

/**
 * CR-094 capability keys. These are **grantable but non-privileged**: they are stored in
 * `_users.roles`, shown in the UI and carried into the audit trail, but no guard,
 * `validate_doc_update` branch or permission-matrix row reads them yet. A holder has exactly
 * the access of an authenticated staff member in their own shelter — see CR-094 §2.1.
 */
export const TEAM_COORDINATOR = 'team_coordinator';
export const OPERATIONS_STAFF = 'operations_staff';
export const MEDICAL_STAFF = 'medical_staff';
export const TRIAGE_STAFF = 'triage_staff';
export const VOLUNTEER_COORDINATOR = 'volunteer_coordinator';

/**
 * Capability roles a shelter_manager is allowed to grant, in the order the role picker
 * shows them (CR-094 §2.1, minus `system_admin`/`shelter_manager` which an SM may not grant).
 */
export const STAFF_CAPABILITIES = [
	TEAM_COORDINATOR,
	OPERATIONS_STAFF,
	MEDICAL_STAFF,
	WAREHOUSE_STAFF,
	REGISTRATION_STAFF,
	TRIAGE_STAFF,
	KITCHEN_STAFF,
	VOLUNTEER_COORDINATOR
] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/**
 * The subset of {@link STAFF_CAPABILITIES} that permission checks actually branch on today.
 * Everything else in the list is vocabulary only. Keep this list in step with the guards in
 * `$lib/guards/auth.ts`, `shelter-access-design.ts` and `role-permission-matrix.md` §3-§5.
 */
export const ENFORCED_CAPABILITIES = [REGISTRATION_STAFF, KITCHEN_STAFF, WAREHOUSE_STAFF] as const;

/** True when a capability is one the RBAC layer actually enforces (vs. label-only, CR-094). */
export function isEnforcedCapability(role: string): boolean {
	return (ENFORCED_CAPABILITIES as readonly string[]).includes(role);
}

/** Every capability an SA may grant alongside the shelter scope — manager first, as in the picker. */
export const SHELTER_CAPABILITIES = [SHELTER_MANAGER, ...STAFF_CAPABILITIES] as const;
export type ShelterCapability = (typeof SHELTER_CAPABILITIES)[number];

/** Roles an SA may pick in the portal user form (shelter capabilities + system_admin). */
export const SA_GRANTABLE_CAPABILITIES = [SYSTEM_ADMIN, ...SHELTER_CAPABILITIES] as const;
export type SaGrantableCapability = (typeof SA_GRANTABLE_CAPABILITIES)[number];

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

/** UI copy for one capability. Stored RoleKey values stay English; only display text is Thai. */
export interface RoleMeta {
	/** Thai name shown as the primary label. */
	th: string;
	/** English name in parentheses, as the ops team says it out loud. */
	en: string;
	/** One-line description of what the role does, shown under the picker option. */
	description: string;
}

/**
 * Display metadata for every grantable capability (CR-094 §2.1). Typed as a total record over
 * `SaGrantableCapability`, so adding a key to the vocabulary above fails the type-check here
 * until its copy is written — the picker can never render a nameless role.
 */
export const ROLE_META: Record<SaGrantableCapability, RoleMeta> = {
	[SYSTEM_ADMIN]: {
		th: 'ผู้ดูแลระบบสูงสุด',
		en: 'System Admin',
		description: 'ดูแลระบบส่วนกลาง ตั้งค่าและจัดการโครงสร้างทั้งหมด'
	},
	[SHELTER_MANAGER]: {
		th: 'ผู้จัดการศูนย์พักพิง',
		en: 'Shelter Manager',
		description: 'บริหารจัดการภาพรวมและนโยบายภายในศูนย์พักพิง'
	},
	[TEAM_COORDINATOR]: {
		th: 'ผู้ประสานงานทีม',
		en: 'Team Coordinator',
		description: 'จำกัดสิทธิ์เฉพาะจัดการกะและคัดกรองผู้สมัครในงานที่ได้รับมอบหมาย'
	},
	[OPERATIONS_STAFF]: {
		th: 'เจ้าหน้าที่ปฏิบัติการทั่วไป',
		en: 'Operations Staff',
		description: 'ปฏิบัติงานทั่วไปในศูนย์พักพิง'
	},
	[MEDICAL_STAFF]: {
		th: 'แพทย์ / เจ้าหน้าที่คัดกรองพยาบาล',
		en: 'Doctor / Nurse',
		description: 'คัดกรองผู้ป่วย ประเมินกลุ่มเปราะบาง และสวัสดิการพยาบาล'
	},
	[WAREHOUSE_STAFF]: {
		th: 'ผู้จัดการคลังเสบียง / ส่งต่อสิ่งของ',
		en: 'Logistics Lead',
		description: 'รับ-จ่าย และกระจายสิ่งของเสบียงในคลัง'
	},
	[REGISTRATION_STAFF]: {
		th: 'เจ้าหน้าที่ลงทะเบียนหน้าด่าน',
		en: 'Smart Reg Staff',
		description: 'รับลงทะเบียนผู้อพยพและจัดสรรโซนที่พัก'
	},
	[TRIAGE_STAFF]: {
		th: 'เจ้าหน้าที่คัดกรองเฉพาะทาง',
		en: 'Triage Staff',
		description: 'คัดกรองสุขภาพและแยกกลุ่มผู้พักพิง'
	},
	[KITCHEN_STAFF]: {
		th: 'เจ้าหน้าที่ครัว / จัดเตรียมอาหาร',
		en: 'Kitchen Lead',
		description: 'จัดการรอบปรุงอาหารและบันทึกแจกจ่ายมื้ออาหาร'
	},
	[VOLUNTEER_COORDINATOR]: {
		th: 'ผู้ประสานงานจิตอาสา',
		en: 'Volunteer Coordinator',
		description: 'จัดสรรงานจิตอาสาและตรวจรับรองชั่วโมงปฏิบัติงาน'
	}
};

function roleMeta(role: string): RoleMeta | undefined {
	return (ROLE_META as Record<string, RoleMeta>)[role];
}

/**
 * Human-readable Thai label for a single CouchDB role string. Shelter-scope
 * roles render as `ศูนย์ SH001`. Unknown values fall back to the raw role
 * string so the UI never goes blank.
 */
export function roleDisplayLabel(role: string): string {
	if (role === COUCH_ADMIN) return 'ผู้ดูแล CouchDB';
	if (role.startsWith('shelter:')) {
		return `ศูนย์ ${role.slice('shelter:'.length)}`;
	}
	return roleMeta(role)?.th ?? role;
}

/** Bilingual label for the role picker — `ผู้จัดการศูนย์พักพิง (Shelter Manager)`. */
export function roleOptionLabel(role: string): string {
	const meta = roleMeta(role);
	return meta ? `${meta.th} (${meta.en})` : roleDisplayLabel(role);
}

/** One-line duty description shown beside a role option; empty for unknown roles. */
export function roleDescription(role: string): string {
	return roleMeta(role)?.description ?? '';
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
