import { bangkokToday, formatThaiShortDate } from '$lib/utils/date';
import {
	DISTRIBUTION_STAFF,
	FACILITY_STAFF,
	compoundCapabilityRole,
	type StaffCapability
} from './roles';

/**
 * Time-limited staff roles issued by a volunteer coordinator (#955, #879 item 2).
 *
 * A grant is stored on the `_users` doc as `role_grants[]` next to the compound role it created
 * (`SHxxx:<role>`). The worker removes the role and its grant once `expires_at` has passed.
 * A role without a grant was given by a shelter manager and never expires.
 */
export type RoleGrant = {
	shelter_code: string;
	/** Bare capability, e.g. `kitchen_staff`. */
	role: string;
	/** ISO instant: the end of the chosen Bangkok day. */
	expires_at: string;
	granted_by: string;
	granted_at: string;
};

/** The only roles a coordinator may issue (#879 item 2). */
export const COORDINATOR_GRANTABLE_ROLES = [
	'registration_staff',
	'kitchen_staff',
	DISTRIBUTION_STAFF,
	FACILITY_STAFF
] as const satisfies readonly StaffCapability[];
export type CoordinatorGrantableRole = (typeof COORDINATOR_GRANTABLE_ROLES)[number];

/** A coordinator may pick an expiry from today up to today + this many days. */
export const MAX_GRANT_DAYS = 7;

export function isCoordinatorGrantableRole(role: unknown): role is CoordinatorGrantableRole {
	return (COORDINATOR_GRANTABLE_ROLES as readonly unknown[]).includes(role);
}

/** `YYYY-MM-DD` plus `days`, calendar arithmetic only (no time zone involved). */
function addDays(date: string, days: number): string {
	const [y, m, d] = date.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Selectable expiry dates (Asia/Bangkok): today through today + {@link MAX_GRANT_DAYS}. */
export function grantExpiryRange(now: Date = new Date()): { min: string; max: string } {
	const min = bangkokToday(now);
	return { min, max: addDays(min, MAX_GRANT_DAYS) };
}

/** Why `date` is not an allowed coordinator expiry, or `null` when it is. */
export function grantExpiryError(date: unknown, now: Date = new Date()): string | null {
	if (typeof date !== 'string' || date === '') return 'กรุณาเลือกวันหมดอายุ';
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || addDays(date, 0) !== date) {
		return 'รูปแบบวันหมดอายุไม่ถูกต้อง';
	}
	const { min, max } = grantExpiryRange(now);
	if (date < min) return 'วันหมดอายุต้องไม่ใช่วันที่ผ่านมาแล้ว';
	if (date > max) return `วันหมดอายุต้องไม่เกิน ${MAX_GRANT_DAYS} วันนับจากวันนี้`;
	return null;
}

/** The instant a grant expires: the end of Bangkok day `date`. */
export function grantExpiresAt(date: string): string {
	return new Date(`${date}T23:59:59.999+07:00`).toISOString();
}

export function grantFor(
	grants: readonly RoleGrant[] | null | undefined,
	shelterCode: string,
	role: string
): RoleGrant | null {
	return grants?.find((g) => g.shelter_code === shelterCode && g.role === role) ?? null;
}

/** `role_grants` after a user save: a grant stays only while its role stays and is not made permanent. */
export function pruneRoleGrants(
	grants: readonly RoleGrant[] | null | undefined,
	roles: readonly string[],
	permanentRoles: readonly string[] = []
): RoleGrant[] {
	return (grants ?? []).filter((g) => {
		const compound = compoundCapabilityRole(g.shelter_code, g.role);
		return roles.includes(compound) && !permanentRoles.includes(compound);
	});
}

/** Edit-page note for a granted role, e.g. `หมดอายุสิ้นวันที่ 30/10/2569`. */
export function grantExpiryLabel(grant: RoleGrant): string {
	return `หมดอายุสิ้นวันที่ ${formatThaiShortDate(grant.expires_at)}`;
}
