import { hasShelterScope, isShelterManager, isSystemAdmin } from '$lib/auth/roles';

/**
 * Who may override an evacuee's stay status (any → any, CR-262 A1): a system admin, or the
 * shelter manager of the shelter being worked in. Scoped to that shelter, so a manager of a
 * second shelter is not refused there, and a manager elsewhere is not let in (#1477 review W3).
 * Without a current shelter nobody but a system admin may.
 */
export function canOverrideStayStatus(roles: readonly string[], shelterCode: string): boolean {
	if (isSystemAdmin(roles)) return true;
	const shelter = shelterCode.trim().toUpperCase();
	if (!shelter) return false;
	return hasShelterScope(roles, shelter) && isShelterManager(roles, shelter);
}
