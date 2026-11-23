const STORAGE_KEY = 'tent.activeShelterCode';

function readPersistedShelterCode(): string | undefined {
	if (typeof localStorage === 'undefined') return undefined;
	try {
		const value = localStorage.getItem(STORAGE_KEY);
		return value && value.length > 0 ? value : undefined;
	} catch {
		return undefined;
	}
}

/** Persist the active workspace shelter so switching remembers the last choice. */
export function persistSelectedShelter(code: string | undefined): void {
	if (typeof localStorage === 'undefined') return;
	try {
		if (code) localStorage.setItem(STORAGE_KEY, code);
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* ignore quota / private mode */
	}
}

export class ShelterStore {
	/** Active workspace shelter — restored from localStorage when possible. */
	selectedShelterCode = $state<string | undefined>(readPersistedShelterCode());
	/** First shelter from navbar list — set when shelters load. */
	listDefaultCode = $state<string | undefined>(undefined);
	/**
	 * The selected code when it is only a stand-in picked from the roles before the shelter list
	 * loaded (#1473): not remembered, and replaced by the list-order pick. Any other writer that
	 * changes `selectedShelterCode` makes it a real choice again, since the codes stop matching.
	 */
	provisionalCode = $state<string | undefined>(undefined);
}

export const shelterStore = new ShelterStore();

/** The current selection is a stand-in, not a remembered choice. */
export function isSelectionProvisional(): boolean {
	const code = shelterStore.selectedShelterCode;
	return code !== undefined && code === shelterStore.provisionalCode;
}

/**
 * Apply a resolved active-shelter choice: select it, and remember it only once it is settled.
 * Writes nothing when nothing changed, so the effect that calls it does not loop or rewrite
 * localStorage on every run.
 */
export function applyActiveShelterChoice(choice: {
	code: string | undefined;
	provisional: boolean;
}): void {
	const wasProvisional = isSelectionProvisional();
	const changed = shelterStore.selectedShelterCode !== choice.code;
	if (changed) shelterStore.selectedShelterCode = choice.code;
	const nextProvisional = choice.provisional ? choice.code : undefined;
	if (shelterStore.provisionalCode !== nextProvisional) {
		shelterStore.provisionalCode = nextProvisional;
	}
	if (!choice.provisional && (changed || wasProvisional)) persistSelectedShelter(choice.code);
}
