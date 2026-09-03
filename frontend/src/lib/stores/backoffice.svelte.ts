import { authStore } from './auth.svelte';

export class BackofficeState {
	private reauthState = $state({ requested: false });

	/**
	 * True when the cached identity exists but the CouchDB session cookie is no
	 * longer valid (`authStore.needsReauth`). UI shows a session-expired badge
	 * and re-login dialog — not a local/offline write mode.
	 */
	get isOffline(): boolean {
		return authStore.needsReauth;
	}

	get reauthRequested(): boolean {
		return this.reauthState.requested;
	}

	requestReauth(): void {
		this.reauthState.requested = true;
	}

	clearReauthRequest(): void {
		this.reauthState.requested = false;
	}
}

export const backofficeState = new BackofficeState();
