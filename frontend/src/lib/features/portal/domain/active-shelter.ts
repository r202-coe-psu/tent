/**
 * Which shelter `/portal` should treat as the active one (#1473).
 *
 * The choice is remembered in localStorage, so after another account — or a logout — it can
 * name a shelter this user has no role in; the menu is filtered by it and comes out empty.
 * Pure: the route passes what it knows and applies the answer.
 */
export type ResolveActiveShelterInput = {
	/** The shelter currently selected (restored from localStorage), if any. */
	current: string | undefined;
	/** Shelters the user may pick: the loaded shelter list narrowed to their roles (all for SA). */
	allowedCodes: readonly string[];
	/** Shelter codes carried by the user's roles (`shelter:{code}`). */
	userShelterCodes: readonly string[];
	isSystemAdmin: boolean;
};

/**
 * The shelter to select, or `undefined` when there is nothing to choose (no roles yet; or a
 * system admin before the shelter list has loaded).
 *
 * A usable current choice is kept. Otherwise the first allowed shelter wins. When the list has
 * not loaded — or does not contain the user's shelter — the roles alone decide, so the menu
 * never depends on a list that may be late or missing.
 */
export function resolveActiveShelter({
	current,
	allowedCodes,
	userShelterCodes,
	isSystemAdmin
}: ResolveActiveShelterInput): string | undefined {
	if (current && allowedCodes.includes(current)) return current;
	if (allowedCodes.length > 0) {
		return allowedCodes.find((code) => userShelterCodes.includes(code)) ?? allowedCodes[0];
	}
	if (isSystemAdmin) return undefined;
	if (current && userShelterCodes.includes(current)) return current;
	return userShelterCodes[0];
}
