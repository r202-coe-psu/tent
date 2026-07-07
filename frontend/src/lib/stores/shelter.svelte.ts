export class ShelterStore {
	selectedShelterCode = $state<string | undefined>(undefined);
	/** First shelter from navbar list — set when shelters load. */
	listDefaultCode = $state<string | undefined>(undefined);
}

export const shelterStore = new ShelterStore();
