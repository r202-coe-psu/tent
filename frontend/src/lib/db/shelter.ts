import { namedLocalDb } from './pouch';
import { authStore } from '$lib/stores/auth.svelte';
import { shelterCodeFromRoles } from '$lib/auth/roles';
import { shelterStore } from '$lib/stores/shelter.svelte';

/**
 * The shelter code for the currently authenticated user,
 * derived from their `shelter:{code}` role. Falls back to 'SH001'
 * only as a last resort (e.g. system_admin with no shelter scope).
 */
export function getShelterCode(): string {
	if (shelterStore.selectedShelterCode) {
		return shelterStore.selectedShelterCode;
	}
	const roles = authStore.user?.roles ?? [];
	return shelterCodeFromRoles(roles) ?? 'SH001';
}

/** The CouchDB / PouchDB database name for the current user's shelter. */
export function getShelterDb(): string {
	return `shelter_${getShelterCode().toLowerCase()}`;
}

export function shelterDb(): PouchDB.Database {
	return namedLocalDb(getShelterDb());
}
