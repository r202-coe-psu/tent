/**
 * Role kernel — the canonical CouchDB role vocabulary (docs/prd/role-permission-matrix.md §1.1,
 * docs/data/data-model.md §6, CR-093 / CR-104). Pure + isomorphic: shared by the server BFF
 * (authorization) and the client (forms, nav). No I/O, no Svelte.
 *
 * `_users.roles` is either `["system_admin"]` (global) or Compound Scoped Roles:
 * `["shelter:SH001", "shelter:SH002", "SH001:shelter_manager", "SH002:registration_staff"]`.
 * Legacy flat form `["shelter:SH001", "registration_staff"]` is still accepted (read + write gate).
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
export const DISTRIBUTION_STAFF = 'distribution_staff';
/** Looks after the kiosk devices of one shelter (draft CR scanner back-office FR-SBO-28). */
export const KIOSK_STAFF = 'kiosk_staff';
/** Manages the kiosk banners of one shelter, but not its kiosk devices (issue #930). */
export const PR_STAFF = 'pr_staff';

/**
 * Capability roles a shelter_manager may grant (per CR-104 §2.1). A volunteer_coordinator may
 * grant only {@link COORDINATOR_GRANTABLE_CAPABILITIES}, never all of these.
 */
export const STAFF_CAPABILITIES = [
	'registration_staff',
	TRIAGE_STAFF,
	MEDICAL_STAFF,
	'kitchen_staff',
	SUPPLY_COORDINATOR,
	WAREHOUSE_STAFF,
	VOLUNTEER_COORDINATOR,
	SECURITY_OFFICER,
	FACILITY_STAFF,
	DISTRIBUTION_STAFF,
	KIOSK_STAFF,
	PR_STAFF
] as const;
export type StaffCapability = (typeof STAFF_CAPABILITIES)[number];

/**
 * The only roles a volunteer_coordinator may issue to a volunteer, each with an expiry
 * (draft-coordinator-limited-access-grant FR-2; #879 item 2).
 */
export const COORDINATOR_GRANTABLE_CAPABILITIES = [
	'registration_staff',
	'kitchen_staff',
	DISTRIBUTION_STAFF,
	FACILITY_STAFF
] as const satisfies readonly StaffCapability[];

/** Every capability an SA may grant alongside the shelter scope. */
export const SHELTER_CAPABILITIES = [...STAFF_CAPABILITIES, SHELTER_MANAGER] as const;
export type ShelterCapability = (typeof SHELTER_CAPABILITIES)[number];

/** Roles an SA may pick in the portal user form (shelter capabilities + system_admin). */
export const SA_GRANTABLE_CAPABILITIES = [...SHELTER_CAPABILITIES, SYSTEM_ADMIN] as const;
export type SaGrantableCapability = (typeof SA_GRANTABLE_CAPABILITIES)[number];

/** The CouchDB server-admin role — never mintable through the app. */
export const COUCH_ADMIN = '_admin';

/** One shelter + the capabilities granted there (form / merge unit). */
export type ShelterAssignment = {
	shelter_code: string;
	capabilities: ShelterCapability[];
};

/** Shelter-scope role string for a shelter code, e.g. `SH001` → `shelter:SH001`. */
export function shelterScopeRole(code: string): string {
	return `shelter:${code}`;
}

/** Compound capability role, e.g. `SH001` + `registration_staff` → `SH001:registration_staff`. */
export function compoundCapabilityRole(code: string, capability: string): string {
	return `${code}:${capability}`;
}

/**
 * Parse `{code}:{capability}` — returns null for `shelter:{code}`, bare RoleKeys, or junk.
 */
export function parseCompoundCapability(role: string): { code: string; capability: string } | null {
	if (role.startsWith('shelter:')) return null;
	const idx = role.indexOf(':');
	if (idx <= 0) return null;
	const code = role.slice(0, idx);
	const capability = role.slice(idx + 1);
	if (!code || !capability) return null;
	return { code, capability };
}

/** Extract all shelter codes from a role list (`["shelter:SH001", "shelter:SH002"]` → `["SH001", "SH002"]`). */
export function shelterCodesFromRoles(roles: readonly string[]): string[] {
	return roles.filter((r) => r.startsWith('shelter:')).map((r) => r.slice('shelter:'.length));
}

/** Extract the first shelter code from a role list, or null. Prefer {@link shelterCodesFromRoles} for multi. */
export function shelterCodeFromRoles(roles: readonly string[]): string | null {
	const codes = shelterCodesFromRoles(roles);
	return codes.length > 0 ? codes[0] : null;
}

/** True when roles include database access for this shelter (`shelter:{code}`). */
export function hasShelterScope(roles: readonly string[], shelterCode: string): boolean {
	return roles.includes(shelterScopeRole(shelterCode));
}

function isKnownShelterCapability(cap: string): cap is ShelterCapability {
	return (SHELTER_CAPABILITIES as readonly string[]).includes(cap);
}

function bareCapabilityRoles(roles: readonly string[]): string[] {
	return roles.filter((r) => {
		if (r.startsWith('shelter:')) return false;
		if (r === SYSTEM_ADMIN || r === COUCH_ADMIN) return false;
		return parseCompoundCapability(r) === null;
	});
}

/**
 * Capabilities granted for one shelter (compound + legacy flat when that is the only scope).
 */
export function capabilitiesForShelter(
	roles: readonly string[],
	shelterCode: string
): ShelterCapability[] {
	const found = new Set<ShelterCapability>();
	for (const r of roles) {
		const parsed = parseCompoundCapability(r);
		if (parsed && parsed.code === shelterCode && isKnownShelterCapability(parsed.capability)) {
			found.add(parsed.capability);
		}
	}
	const codes = shelterCodesFromRoles(roles);
	if (codes.length === 1 && codes[0] === shelterCode) {
		for (const bare of bareCapabilityRoles(roles)) {
			if (isKnownShelterCapability(bare)) found.add(bare);
		}
	}
	return [...found];
}

/** Shelters where the user holds any of `capabilities` (SA → null = every shelter). */
export function shelterCodesWithCapability(
	roles: readonly string[],
	capabilities: readonly string[]
): string[] | null {
	if (isSystemAdmin(roles)) return null;
	return shelterCodesFromRoles(roles).filter((code) =>
		capabilities.some((cap) => hasCapabilityInShelter(roles, code, cap))
	);
}

/** True when every code is in the user's scope for one of `capabilities` (SA always; empty list never). */
export function canManageInShelters(
	roles: readonly string[],
	shelterCodes: readonly string[],
	capabilities: readonly string[]
): boolean {
	if (isSystemAdmin(roles)) return true;
	if (shelterCodes.length === 0) return false;
	return shelterCodes.every((code) =>
		capabilities.some((cap) => hasCapabilityInShelter(roles, code, cap))
	);
}

/** True when any of `capabilities` is held in at least one shelter (SA always) — nav visibility. */
export function hasCapabilityAnywhere(
	roles: readonly string[],
	capabilities: readonly string[]
): boolean {
	const codes = shelterCodesWithCapability(roles, capabilities);
	return codes === null || codes.length > 0;
}

/** Capabilities that manage scanner / kiosk devices (CR scanner back-office). */
export const SCANNER_MANAGER_CAPABILITIES = [SHELTER_MANAGER, KIOSK_STAFF] as const;

/**
 * True when the user may manage scanner devices in `shelterCode` (SA, or its shelter_manager /
 * kiosk_staff).
 */
export function canManageScanners(roles: readonly string[], shelterCode: string): boolean {
	return canManageInShelters(roles, [shelterCode], SCANNER_MANAGER_CAPABILITIES);
}

/** Capabilities that may issue stock out of the warehouse directly (#837). */
export const STOCK_DISTRIBUTOR_CAPABILITIES = [WAREHOUSE_STAFF, SHELTER_MANAGER] as const;

/**
 * True when the user may directly distribute stock in `shelterCode` (SA, or its warehouse_staff /
 * shelter_manager). `supply_coordinator` views stock but does not issue it.
 */
export function canDistributeStock(roles: readonly string[], shelterCode: string): boolean {
	return canManageInShelters(roles, [shelterCode], STOCK_DISTRIBUTOR_CAPABILITIES);
}

/** Capabilities that manage kiosk banners of a shelter (issue #930). */
export const BANNER_MANAGER_CAPABILITIES = [SHELTER_MANAGER, KIOSK_STAFF, PR_STAFF] as const;

/**
 * Capabilities that may read a shelter's kiosk devices and reveal their staff PIN, without
 * changing them (CR-203). Listed on its own so a future banner-only role does not gain PIN access.
 */
export const DEVICE_VIEWER_CAPABILITIES = [SHELTER_MANAGER, KIOSK_STAFF, PR_STAFF] as const;

/**
 * True when the user may manage kiosk banners in `shelterCode` (SA, or its shelter_manager /
 * kiosk_staff / pr_staff).
 */
export function canManageBanners(roles: readonly string[], shelterCode: string): boolean {
	return canManageInShelters(roles, [shelterCode], BANNER_MANAGER_CAPABILITIES);
}

/** Which kiosk back-office area a confined user may open (FR-SBO-29, issue #930). */
export type KioskConfinement = 'devices' | 'banners';

/**
 * How the user is confined to the kiosk pages in `shelterCode` (every shelter when null):
 * - `'devices'` — only `kiosk_staff` / `pr_staff` held, `kiosk_staff` among them: may open all of
 *   `/back-office/kiosks/**`.
 * - `'banners'` — `pr_staff` only: may open just `/back-office/kiosks/banners/**`.
 * - `null` — not confined: SA, no capability, or any capability beyond kiosk_staff / pr_staff.
 */
export function kioskConfinement(
	roles: readonly string[],
	shelterCode: string | null | undefined
): KioskConfinement | null {
	if (isSystemAdmin(roles)) return null;
	const codes = shelterCode ? [shelterCode] : shelterCodesFromRoles(roles);
	const caps = codes.flatMap((code) => capabilitiesForShelter(roles, code));
	if (caps.length === 0) return null;
	if (!caps.every((cap) => cap === KIOSK_STAFF || cap === PR_STAFF)) return null;
	return caps.includes(KIOSK_STAFF) ? 'devices' : 'banners';
}

/**
 * True when the user is confined to the kiosk pages (see {@link kioskConfinement}) — such a user
 * sees nothing in back-office but the kiosk area (FR-SBO-29).
 */
export function isKioskStaffOnly(
	roles: readonly string[],
	shelterCode: string | null | undefined
): boolean {
	return kioskConfinement(roles, shelterCode) !== null;
}

/** Shelter codes where the user holds `shelter_manager` (compound or legacy). */
export function managerShelterCodes(roles: readonly string[]): string[] {
	return shelterCodesFromRoles(roles).filter((code) =>
		hasCapabilityInShelter(roles, code, SHELTER_MANAGER)
	);
}

/**
 * True when `capability` is held in `shelterCode`. SA / Couch `_admin` always true.
 * When `shelterCode` is null/undefined, true if held in any shelter (or legacy flat).
 */
export function hasCapabilityInShelter(
	roles: readonly string[],
	shelterCode: string | null | undefined,
	capability: string
): boolean {
	if (isSystemAdmin(roles)) return true;
	if (!shelterCode) {
		if (roles.includes(capability)) return true;
		return roles.some((r) => {
			const parsed = parseCompoundCapability(r);
			return parsed?.capability === capability;
		});
	}
	if (!hasShelterScope(roles, shelterCode)) return false;
	if (roles.includes(compoundCapabilityRole(shelterCode, capability))) return true;
	const codes = shelterCodesFromRoles(roles);
	if (codes.length === 1 && codes[0] === shelterCode && roles.includes(capability)) return true;
	return false;
}

/** Build CouchDB `roles[]` from per-shelter assignments (always compound form). */
export function rolesFromAssignments(assignments: readonly ShelterAssignment[]): string[] {
	const out: string[] = [];
	const seenScope = new Set<string>();
	for (const a of assignments) {
		if (!a.shelter_code || a.capabilities.length === 0) continue;
		if (!seenScope.has(a.shelter_code)) {
			out.push(shelterScopeRole(a.shelter_code));
			seenScope.add(a.shelter_code);
		}
		for (const cap of a.capabilities) {
			const compound = compoundCapabilityRole(a.shelter_code, cap);
			if (!out.includes(compound)) out.push(compound);
		}
	}
	return out;
}

/** Parse `_users.roles` into per-shelter assignments (supports legacy flat). */
export function assignmentsFromRoles(roles: readonly string[]): ShelterAssignment[] {
	if (isAppSystemAdmin(roles)) return [];
	const codes = shelterCodesFromRoles(roles);
	return codes.map((shelter_code) => ({
		shelter_code,
		capabilities: capabilitiesForShelter(roles, shelter_code)
	}));
}

/**
 * Replace (or add) one shelter's capabilities; preserve other shelters' compound roles.
 * Drops legacy bare capabilities so the result is compound-only.
 */
export function mergeShelterAssignment(
	existingRoles: readonly string[],
	shelterCode: string,
	capabilities: readonly string[]
): string[] {
	const keptAssignments = assignmentsFromRoles(existingRoles).filter(
		(a) => a.shelter_code !== shelterCode
	);
	const nextCaps = capabilities.filter(isKnownShelterCapability);
	if (nextCaps.length > 0) {
		keptAssignments.push({ shelter_code: shelterCode, capabilities: nextCaps });
	}
	return rolesFromAssignments(keptAssignments);
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

/**
 * True when the role list denotes a shelter_manager.
 * With `shelterCode`, only that shelter; otherwise any shelter (compound or legacy).
 */
export function isShelterManager(roles: readonly string[], shelterCode?: string | null): boolean {
	if (shelterCode) return hasCapabilityInShelter(roles, shelterCode, SHELTER_MANAGER);
	if (roles.includes(SHELTER_MANAGER)) return true;
	return roles.some((r) => {
		const parsed = parseCompoundCapability(r);
		return parsed?.capability === SHELTER_MANAGER;
	});
}

/**
 * True when the actor may cancel a pre-registration hold (D-HOLD-CANCEL / CR-070):
 * system_admin, shelter_manager, or registration_staff (optionally scoped to active shelter).
 */
export function canCancelHold(roles: readonly string[], shelterCode?: string | null): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles, shelterCode) ||
		hasStaffCapability(roles, 'registration_staff', shelterCode)
	);
}

/**
 * Station 1 Unassigned Registration **claim** CTA / queue desk (CR-113 / #247 / #251).
 * Same registration desk gate as hold cancel (SA / shelter_manager / registration_staff).
 * Federated **search** is wider (any shelter-scoped staff) — see BFF search auth.
 */
export function canAccessUnassignedRegistrationQueue(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return canCancelHold(roles, shelterCode);
}

/**
 * True when the actor may access the Station 2 medical screening route / queue:
 * system_admin, shelter_manager, registration_staff, medical_staff, or triage_staff.
 * (registration_staff added by decision sync 2026-10-10 — ADR 0001.)
 */
export function canAccessMedicalScreening(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles, shelterCode) ||
		hasStaffCapability(roles, 'registration_staff', shelterCode) ||
		hasStaffCapability(roles, MEDICAL_STAFF, shelterCode) ||
		hasStaffCapability(roles, TRIAGE_STAFF, shelterCode)
	);
}

/**
 * True when the actor may use the staff volunteer back-office (`/back-office/volunteers` job
 * board, shifts, roster): system_admin, shelter_manager, or volunteer_coordinator in the shelter
 * (role-permission-matrix.md §3 "Volunteer Job Board"; decision sync 2026-10-10). Does **not**
 * cover user management — granting system access to a volunteer stays SM/SA.
 */
export function canAccessVolunteerBackoffice(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles, shelterCode) ||
		hasStaffCapability(roles, VOLUNTEER_COORDINATOR, shelterCode)
	);
}

/**
 * True when the actor may use the Distribution Desk (Station 4, `/onsite/distribution`):
 * system_admin, shelter_manager, or distribution_staff in the shelter (CR-161 R5, page-level per
 * CR-159). REG, SC and WH keep their system-level distribution rights but not this page.
 */
export function canAccessDistributionDesk(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles, shelterCode) ||
		hasStaffCapability(roles, DISTRIBUTION_STAFF, shelterCode)
	);
}

/**
 * True when the actor may access Station 3 zoning:
 * system_admin, shelter_manager, registration_staff, or facility_staff.
 */
export function canAccessZoning(roles: readonly string[], shelterCode?: string | null): boolean {
	return (
		isSystemAdmin(roles) ||
		isShelterManager(roles, shelterCode) ||
		hasStaffCapability(roles, 'registration_staff', shelterCode) ||
		hasStaffCapability(roles, FACILITY_STAFF, shelterCode)
	);
}

/**
 * Shelter Incident Log — incident staff only: system_admin, or security_officer / shelter_manager
 * in the shelter (owner decision; other shelter staff lose access). Without `shelterCode`, true
 * when either capability is held in any shelter. Per-record rights live in `features/incidents`
 * policy + VDU.
 */
export function canAccessIncidents(roles: readonly string[], shelterCode?: string | null): boolean {
	return (
		isSystemAdmin(roles) ||
		hasStaffCapability(roles, SECURITY_OFFICER, shelterCode) ||
		isShelterManager(roles, shelterCode)
	);
}

/** True when the role list includes warehouse/supply capability (any or scoped shelter). */
export function isWarehouseStaff(roles: readonly string[], shelterCode?: string | null): boolean {
	return (
		hasStaffCapability(roles, WAREHOUSE_STAFF, shelterCode) ||
		hasStaffCapability(roles, SUPPLY_COORDINATOR, shelterCode)
	);
}

/** Pages gated by `requireManager`: system_admin or shelter_manager of the shelter. */
export function canAccessManagerPages(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return isSystemAdmin(roles) || isShelterManager(roles, shelterCode);
}

/** `requireWarehouseAccess`: SA, SM, or warehouse_staff / supply_coordinator of the shelter. */
export function canAccessWarehouse(roles: readonly string[], shelterCode?: string | null): boolean {
	return canAccessManagerPages(roles, shelterCode) || isWarehouseStaff(roles, shelterCode);
}

/** `requireKitchen`: SA, SM, or kitchen_staff of the shelter. */
export function canAccessKitchen(roles: readonly string[], shelterCode?: string | null): boolean {
	return (
		canAccessManagerPages(roles, shelterCode) ||
		hasStaffCapability(roles, 'kitchen_staff', shelterCode)
	);
}

/** `requireTicketAccess`: warehouse side or kitchen_staff (plus SA/SM). */
export function canAccessTickets(roles: readonly string[], shelterCode?: string | null): boolean {
	return canAccessWarehouse(roles, shelterCode) || canAccessKitchen(roles, shelterCode);
}

/** `requireEvacueeRegistration`: SA, SM, or registration_staff of the shelter. */
export function canAccessEvacueeRegistration(
	roles: readonly string[],
	shelterCode?: string | null
): boolean {
	return (
		canAccessManagerPages(roles, shelterCode) ||
		hasStaffCapability(roles, 'registration_staff', shelterCode)
	);
}

/**
 * True when the roles hold a given staff capability (e.g. `kitchen_staff`).
 * With `shelterCode`, only that shelter; otherwise any shelter / legacy flat.
 */
export function hasStaffCapability(
	roles: readonly string[],
	cap: StaffCapability,
	shelterCode?: string | null
): boolean {
	return hasCapabilityInShelter(roles, shelterCode, cap);
}

/**
 * True when every non-shelter capability in the list is a staff capability
 * (no `shelter_manager`/`system_admin`/`_admin`). A shelter_manager may only
 * create or delete staff — this is that predicate.
 */
export function isStaffOnly(roles: readonly string[]): boolean {
	const staff = STAFF_CAPABILITIES as readonly string[];
	if (roles.includes(SYSTEM_ADMIN) || roles.includes(COUCH_ADMIN)) return false;
	return roles
		.filter((r) => !r.startsWith('shelter:'))
		.every((r) => {
			const parsed = parseCompoundCapability(r);
			const cap = parsed?.capability ?? r;
			return staff.includes(cap);
		});
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
	facility_staff: 'เจ้าหน้าที่ฝ่ายอาคารสถานที่',
	distribution_staff: 'เจ้าหน้าที่แจกจ่าย',
	kiosk_staff: 'เจ้าหน้าที่ดูแลตู้ Kiosk',
	pr_staff: 'เจ้าหน้าที่ประชาสัมพันธ์'
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
	const compound = parseCompoundCapability(role);
	if (compound) {
		const capLabel =
			compound.capability === SHELTER_MANAGER
				? 'ผู้จัดการศูนย์'
				: (STAFF_CAPABILITIES as readonly string[]).includes(compound.capability)
					? STAFF_CAPABILITY_LABELS[compound.capability as StaffCapability]
					: compound.capability;
		return `${capLabel} (${compound.code})`;
	}
	if ((STAFF_CAPABILITIES as readonly string[]).includes(role)) {
		return STAFF_CAPABILITY_LABELS[role as StaffCapability];
	}
	return role;
}

/**
 * Bilingual or display label for the role picker.
 */
export function roleOptionLabel(role: string): string {
	return roleDisplayLabel(role);
}

/**
 * Join a role list into a single human-readable string. Returns `'ผู้ใช้ทั่วไป'`
 * for an empty list — used as the avatar tooltip in the back-office navbar
 * when the user has no assigned roles.
 *
 * Multi-shelter assignments: one shelter per line; capabilities within a shelter
 * are space-separated (e.g. `SH001:เจ้าหน้าที่ลงทะเบียน ผู้จัดการศูนย์`).
 * Consumers that need line breaks should use `whitespace-pre-line`.
 */
export function formatRoleList(roles: readonly string[] | undefined): string {
	if (!roles || roles.length === 0) return 'ผู้ใช้ทั่วไป';
	if (isAppSystemAdmin(roles)) return roleDisplayLabel(SYSTEM_ADMIN);
	const assignments = assignmentsFromRoles(roles);
	if (assignments.length > 0) {
		return assignments
			.map((a) => {
				const caps = a.capabilities
					.map((c) =>
						c === SHELTER_MANAGER
							? 'ผู้จัดการศูนย์'
							: (STAFF_CAPABILITY_LABELS[c as StaffCapability] ?? c)
					)
					.join(' ');
				return `${a.shelter_code}:${caps || '—'}`;
			})
			.join('\n');
	}
	return roles.map(roleDisplayLabel).join(', ');
}
