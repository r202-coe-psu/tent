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
}

export const shelterStore = new ShelterStore();
