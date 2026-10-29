import {
	hasStaffCapability,
	isSystemAdmin,
	isShelterManager,
	isWarehouseStaff
} from '$lib/auth/roles';

/**
 * Who may create or edit shelter-scoped catalog docs (items, categories).
 * The write path re-checks this per shelter (`enforceWriteAccess`), so this is
 * only the gate for showing the UI affordance.
 */
export function canWriteShelterCatalog(roles: readonly string[]): boolean {
	return isSystemAdmin(roles) || isShelterManager(roles) || isWarehouseStaff(roles);
}

/**
 * Recipe CREATE is wider than the rest of the catalog: kitchen staff of the shelter may save the
 * recipe they just built on the production board (#802). Update and delete keep
 * {@link canWriteShelterCatalog}.
 */
export function canCreateShelterRecipe(roles: readonly string[], shelterCode?: string | null) {
	return canWriteShelterCatalog(roles) || hasStaffCapability(roles, 'kitchen_staff', shelterCode);
}
