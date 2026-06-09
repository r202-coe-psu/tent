import { browser } from '$app/environment';
import { getSession, sessionLogin, sessionLogout, type SessionUser } from '$lib/db/couch';
import { startSync, stopSync } from '$lib/db/pouch';

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

	private onSyncAuthError = (): void => {
		this.state.needsReauth = true;
	};

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
	 * Resolve the current session. Optimistically trusts the cached identity so
	 * guards pass without a network round-trip, then validates against CouchDB
	 * in the background. Cached; safe to call repeatedly.
	 */
	ensureInitialized(): Promise<void> {
		if (!browser) return Promise.resolve();
		if (!this.initPromise) {
			this.initPromise = getSession()
				.then((user) => {
					// Online + answered: CouchDB is the source of truth.
					this.state.user = user;
					persistUser(user);
					if (user) {
						this.state.needsReauth = false;
						startSync(this.onSyncAuthError);
					}
				})
				.catch(() => {
					// Offline / server unreachable — keep the cached identity so the
					// user stays in the app. Sync retries automatically once online.
					if (this.state.user) startSync(this.onSyncAuthError);
				});
		}
		return this.initPromise;
	}

	async login(input: { name: string; password: string }): Promise<SessionUser> {
		const user = await sessionLogin(input);
		this.state.user = user;
		this.state.needsReauth = false;
		persistUser(user);
		this.initPromise = Promise.resolve();
		if (browser) startSync(this.onSyncAuthError);
		return user;
	}

	async logout(): Promise<void> {
		try {
			await sessionLogout();
		} finally {
			if (browser) stopSync();
			this.state.user = null;
			this.state.needsReauth = false;
			persistUser(null);
			this.initPromise = Promise.resolve();
		}
	}
}

export const authStore = new AuthStore();
