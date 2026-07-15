import { authStore } from './auth.svelte';

export class BackofficeState {
	/**
	 * True when the cached identity exists but the CouchDB session cookie is no
	 * longer valid (`authStore.needsReauth`). UI shows a session-expired badge
	 * and re-login dialog — not a local/offline write mode.
	 */
	get isOffline(): boolean {
		return authStore.needsReauth;
	}
}

export const backofficeState = new BackofficeState();
