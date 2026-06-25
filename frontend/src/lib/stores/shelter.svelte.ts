export class ShelterStore {
	selectedShelterCode = $state<string | undefined>(undefined);
}

export const shelterStore = new ShelterStore();
