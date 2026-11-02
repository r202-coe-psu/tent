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
 * The only policy for writing (create, update, delete) a recipe: system admin anywhere; without a
 * `shelterCode` (central catalog) nobody else. In a shelter: its shelter manager, warehouse staff,
 * or kitchen staff (#802, CR-217). {@link canWriteShelterCatalog} is only a UI hint.
 */
export function canWriteShelterRecipe(
	roles: readonly string[],
	shelterCode: string | null | undefined
): boolean {
	if (isSystemAdmin(roles)) return true;
	if (!shelterCode) return false;
	return (
		isShelterManager(roles, shelterCode) ||
		isWarehouseStaff(roles, shelterCode) ||
		hasStaffCapability(roles, 'kitchen_staff', shelterCode)
	);
}
