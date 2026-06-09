import { browser } from '$app/environment';
import { startNamedSync, stopNamedSync } from '$lib/db/pouch';
import { authStore } from '$lib/stores/auth.svelte';
import { shelterDbName, type ShelterAccess } from '../domain/shelter';

/**
 * Begin live sync for every shelter the user can access. Returns a cleanup
 * function (use it in an `$effect`). A 401 from any shelter sync flags the auth
 * store's re-auth banner instead of logging the user out.
 */
export function startShelterSync(access: ShelterAccess[]): () => void {
	if (!browser) return () => {};
	const names = access.map((a) => shelterDbName(a.id));
	for (const name of names) startNamedSync(name, () => authStore.markNeedsReauth());
	return () => {
		for (const name of names) stopNamedSync(name);
	};
}
