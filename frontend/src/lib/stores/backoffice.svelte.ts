export class BackofficeState {
	selectedShelter = $state('SH001'); // Default to SH001 as fallback
	isOffline = $state(true); // Default to true to match spec mockup
}

export const backofficeState = new BackofficeState();
