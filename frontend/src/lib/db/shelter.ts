import { namedLocalDb } from './pouch';
import { authStore } from '$lib/stores/auth.svelte';
import { shelterCodeFromRoles } from '$lib/auth/roles';

/**
 * The shelter code for the currently authenticated user,
 * derived from their `shelter:{code}` role. Falls back to 'SH001'
 * only as a last resort (e.g. system_admin with no shelter scope).
 */
export function getShelterCode(): string {
	const roles = authStore.user?.roles ?? [];
	return shelterCodeFromRoles(roles) ?? 'SH001';
}

/** The CouchDB / PouchDB database name for the current user's shelter. */
export function getShelterDb(): string {
	return `shelter_${getShelterCode().toLowerCase()}`;
}

/**
 * @deprecated Use getShelterCode() instead. Kept for non-reactive
 * callsites that read this at module-init time — those must be migrated.
 */
export const SHELTER_CODE = 'SH001';

/**
 * @deprecated Use getShelterDb() instead.
 */
export const SHELTER_DB = `shelter_${SHELTER_CODE.toLowerCase()}`;

export function shelterDb(): PouchDB.Database {
	return namedLocalDb(getShelterDb());
}
