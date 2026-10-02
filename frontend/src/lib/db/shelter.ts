import { authStore } from '$lib/stores/auth.svelte';
import { shelterCodeFromRoles } from '$lib/auth/roles';
import { shelterStore } from '$lib/stores/shelter.svelte';

/**
 * The shelter code for the currently authenticated user,
 * derived from their `shelter:{code}` role. Falls back to 'SH001'
 * only as a last resort (e.g. system_admin with no shelter scope).
 */
export function getShelterCode(): string {
	return resolveShelterCode() ?? 'SH001';
}

/**
 * Same resolution order as {@link getShelterCode} but without the 'SH001'
 * last resort — `null` when no shelter is selected or scoped. Write paths that
 * must never land in the wrong shelter (walk-in registration) use this and
 * block the form instead of guessing.
 */
export function resolveShelterCode(): string | null {
	if (shelterStore.selectedShelterCode) {
		return shelterStore.selectedShelterCode;
	}
	if (shelterStore.listDefaultCode) {
		return shelterStore.listDefaultCode;
	}
	const roles = authStore.user?.roles ?? [];
	return shelterCodeFromRoles(roles) ?? null;
}

/** The CouchDB database name for the current user's shelter. */
export function getShelterDb(shelterCode: string = getShelterCode()): string {
	return `shelter_${shelterCode.toLowerCase()}`;
}
