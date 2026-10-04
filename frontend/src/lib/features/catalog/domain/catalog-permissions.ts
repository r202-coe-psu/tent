import { isSystemAdmin, isShelterManager, isWarehouseStaff } from '$lib/auth/roles';

/**
 * Who may create or edit shelter-scoped catalog docs (items, categories).
 * The write path re-checks this per shelter (`enforceWriteAccess`), so this is
 * only the gate for showing the UI affordance.
 */
export function canWriteShelterCatalog(roles: readonly string[]): boolean {
	return isSystemAdmin(roles) || isShelterManager(roles) || isWarehouseStaff(roles);
}
