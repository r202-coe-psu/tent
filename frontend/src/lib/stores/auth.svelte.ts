import { browser } from '$app/environment';
import { getSession, sessionLogin, sessionLogout, type SessionUser } from '$lib/db/couch';
import { shelterStore } from '$lib/stores/shelter.svelte';

const STORAGE_KEY = 'auth:user';

/** Cached identity, used so the app stays usable offline / across reloads. */
function loadCachedUser(): SessionUser | null {
	if (!browser) return null;
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		return raw ? (JSON.parse(raw) as SessionUser) : null;
	} catch {
		return null;
	}
}

function persistUser(user: SessionUser | null): void {
	if (!browser) return;
	try {
		if (user) localStorage.setItem(STORAGE_KEY, JSON.stringify(user));
		else localStorage.removeItem(STORAGE_KEY);
	} catch {
		/* storage unavailable — ignore */
	}
}

/**
 * Session-backed auth store.
 *
 * Identity (who the user is) and sync-auth (whether the CouchDB cookie is
 * still valid) are deliberately decoupled:
 *
 *  - Identity is cached in localStorage. Normal local-only usage — and surviving
 *    a reload while offline — never requires a network round-trip, so the app
 *    keeps working when CouchDB is unreachable.
 *  - Sync is the only thing that requires a live session. When the cookie
 *    expires the live sync reports 401, we flag `needsReauth` and let the UI
 *    prompt for login instead of ejecting the user from the app.
 */
class AuthStore {
	private state = $state<{ user: SessionUser | null; needsReauth: boolean }>({
		user: loadCachedUser(),
		needsReauth: false
	});
	private initPromise: Promise<void> | null = null;

	/** Flag an expired sync session (e.g. from a feature-managed sync). */
	markNeedsReauth(): void {
		this.state.needsReauth = true;
	}

	get user() {
		return this.state.user;
	}

	get isAuthenticated() {
		return this.state.user !== null;
	}

	/** True when a cached identity exists but the sync session has expired. */
	get needsReauth() {
		return this.state.needsReauth;
	}

	/**
	 * Resolve the current session. When a cached identity exists, route guards
	 * return immediately and CouchDB validation runs in the background. Without
	 * a cache, this awaits a bounded `getSession` round-trip (see couch.ts).
	 * Cached; safe to call repeatedly.
	 */
	ensureInitialized(fetchFn?: typeof fetch): Promise<void> {
		if (!browser) return Promise.resolve();
		if (!this.initPromise) {
			const hadCachedUser = this.state.user !== null;
			if (hadCachedUser) {
				this.initPromise = Promise.resolve();
				void this.refreshSession(fetchFn, true);
			} else {
				this.initPromise = this.refreshSession(fetchFn, false);
			}
		}
		return this.initPromise;
	}

	private async refreshSession(fetchFn?: typeof fetch, hadCachedUser = false): Promise<void> {
		try {
			const user = await getSession(fetchFn);
			if (user) {
				this.state.user = user;
				persistUser(user);
				this.state.needsReauth = false;
				return;
			}
			if (hadCachedUser) {
				// Cookie expired — keep the cached identity and prompt re-login for sync.
				this.state.needsReauth = true;
				return;
			}
			this.state.user = null;
			persistUser(null);
		} catch {
			// Offline / timeout / server unreachable — keep the cached identity.
		}
	}

	async login(input: { name: string; password: string }): Promise<SessionUser> {
		const user = await sessionLogin(input);
		this.state.user = user;
		this.state.needsReauth = false;
		shelterStore.selectedShelterCode = undefined;
		persistUser(user);
		this.initPromise = Promise.resolve();
		return user;
	}

	async logout(): Promise<void> {
		try {
			await sessionLogout();
		} finally {
			this.state.user = null;
			this.state.needsReauth = false;
			shelterStore.selectedShelterCode = undefined;
			persistUser(null);
			this.initPromise = null;
		}
	}
}

export const authStore = new AuthStore();
