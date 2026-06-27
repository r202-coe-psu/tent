import { authStore } from './auth.svelte';

export class BackofficeState {
	selectedShelter = $state(''); // empty = "ยังไม่เลือก", layout effect จะ auto-fill ครั้งแรก

	/**
	 * True when the user is effectively offline: the cached identity exists but
	 * the CouchDB sync session is no longer valid (authStore.needsReauth). The
	 * banner lives in the back-office layout, and the toggle button was removed
	 * because this state is derived from real auth state, not user preference.
	 */
	get isOffline(): boolean {
		return authStore.needsReauth;
	}
}

export const backofficeState = new BackofficeState();
