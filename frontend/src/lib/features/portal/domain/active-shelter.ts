/**
 * Which shelter the staff chrome (`/portal` and the onsite navbar) treats as the active one
 * (#1473).
 *
 * The choice is remembered in localStorage, so after another account — or a logout — it can
 * name a shelter this user has no role in; the menu is filtered by it and comes out empty.
 * Pure: the caller passes what it knows and applies the answer.
 */
export type ResolveActiveShelterInput = {
	/** The shelter currently selected (restored from localStorage), if any. */
	current: string | undefined;
	/** `current` is only a stand-in picked before the list loaded, not a remembered choice. */
	currentProvisional: boolean;
	/** The shelter list has loaded (so `allowedCodes` is final). */
	listLoaded: boolean;
	/** Shelters the user may pick: the loaded shelter list narrowed to their roles (all for SA). */
	allowedCodes: readonly string[];
	/** Shelter codes carried by the user's roles (`shelter:{code}`). */
	userShelterCodes: readonly string[];
	isSystemAdmin: boolean;
};

export type ActiveShelterChoice = {
	/** The shelter to select; `undefined` = none (the remembered one is forgotten). */
	code: string | undefined;
	/** A stand-in until the list loads: select it, but do not remember it. */
	provisional: boolean;
};

/**
 * One order everywhere: the shelter list's (registry) order once it has loaded. Before that the
 * roles pick a stand-in so the menu never waits on a list that may be late or missing — but the
 * stand-in is not remembered and is replaced by the list-order pick when the list arrives.
 * A user with no shelter role left forgets the remembered shelter; a system admin is left
 * as is until the list loads.
 */
export function resolveActiveShelter({
	current,
	currentProvisional,
	listLoaded,
	allowedCodes,
	userShelterCodes,
	isSystemAdmin
}: ResolveActiveShelterInput): ActiveShelterChoice {
	const remembered = currentProvisional ? undefined : current;
	if (!isSystemAdmin && userShelterCodes.length === 0) {
		return { code: undefined, provisional: false };
	}
	if (listLoaded && allowedCodes.length > 0) {
		if (remembered && allowedCodes.includes(remembered)) {
			return { code: remembered, provisional: false };
		}
		const code = allowedCodes.find((c) => userShelterCodes.includes(c)) ?? allowedCodes[0];
		return { code, provisional: false };
	}
	if (isSystemAdmin) return { code: current, provisional: currentProvisional };
	if (remembered && userShelterCodes.includes(remembered)) {
		return { code: remembered, provisional: false };
	}
	return { code: userShelterCodes[0], provisional: !listLoaded };
}
