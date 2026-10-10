import { browser } from '$app/environment';
import { getSession, sessionLogin, sessionLogout, type SessionUser } from '$lib/db/couch';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { clearMfaOk, invalidateAuthStatusRequest } from '$lib/features/users';
import { classifyAuthFailure, createExpiryLatch } from '$lib/auth/session-expiry';

const STORAGE_KEY = 'auth:user';

async function withDisplayName(user: SessionUser): Promise<SessionUser> {
	try {
		const response = await fetch('/api/v1/me', { credentials: 'include' });
		if (!response.ok) return user;
		const profile = (await response.json()) as { name?: unknown; display_name?: unknown };
		if (profile.name !== user.name || typeof profile.display_name !== 'string') return user;
		return { ...user, display_name: profile.display_name.trim() || null };
	} catch {
		return user;
	}
}

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

/** Result of `authStore.handleAuthFailure`. */
export type AuthFailureOutcome = 'expired' | 'permission-denied' | 'ignored';

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
	/** De-dups concurrent 401s so the login modal opens once per expiry. */
	private readonly expiryLatch = createExpiryLatch();
	private verifyPromise: Promise<AuthFailureOutcome> | null = null;
	private revalidatePromise: Promise<void> | null = null;

	/**
	 * Flag an expired session (opens the global login modal). No-op without a cached
	 * identity (nobody to re-authenticate) and idempotent while already flagged.
	 */
	markNeedsReauth(): void {
		if (!this.state.user) return;
		if (!this.expiryLatch.trip()) return;
		this.state.needsReauth = true;
	}

	private clearNeedsReauth(): void {
		this.state.needsReauth = false;
		this.expiryLatch.reset();
	}

	/**
	 * Single entry point for HTTP auth failures (CONTRIBUTING.md §4):
	 *  - 401 from Couch → expired.
	 *  - 403 / BFF 401 → confirm with `GET /_session`; only anonymous means expired.
	 *  - network errors / anything else → ignored here (offline banner handles it).
	 */
	async handleAuthFailure(err: unknown): Promise<AuthFailureOutcome> {
		const kind = classifyAuthFailure(err);
		if (kind === 'session-expired') {
			this.markNeedsReauth();
			return 'expired';
		}
		if (kind !== 'unverified-auth') return 'ignored';
		if (!this.state.user) return 'ignored';
		if (this.state.needsReauth) return 'expired';
		this.verifyPromise ??= this.confirmAnonymous().finally(() => {
			this.verifyPromise = null;
		});
		return this.verifyPromise;
	}

	private async confirmAnonymous(): Promise<AuthFailureOutcome> {
		try {
			const session = await getSession();
			if (session) return 'permission-denied';
			this.markNeedsReauth();
			return 'expired';
		} catch {
			// Offline / timeout — cannot tell; the offline banner owns this case.
			return 'ignored';
		}
	}

	/**
	 * Re-check the cookie against `/_session` (single-flight). Anonymous with a cached
	 * identity flags expiry; a network error keeps the current state.
	 */
	revalidateSession(fetchFn?: typeof fetch): Promise<void> {
		this.revalidatePromise ??= this.refreshSession(fetchFn, this.state.user !== null).finally(
			() => {
				this.revalidatePromise = null;
			}
		);
		return this.revalidatePromise;
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
			const sessionUser = await getSession(fetchFn);
			const user = sessionUser ? await withDisplayName(sessionUser) : null;
			if (user) {
				this.state.user = user;
				persistUser(user);
				this.clearNeedsReauth();
				return;
			}
			if (hadCachedUser) {
				// Cookie expired — keep the cached identity and prompt re-login for sync.
				this.markNeedsReauth();
				return;
			}
			this.state.user = null;
			persistUser(null);
		} catch {
			// Offline / timeout / server unreachable — keep the cached identity.
		}
	}

	async login(input: { name: string; password: string }): Promise<SessionUser> {
		invalidateAuthStatusRequest();
		const user = await withDisplayName(await sessionLogin(input));
		invalidateAuthStatusRequest();
		this.state.user = user;
		this.clearNeedsReauth();
		shelterStore.selectedShelterCode = undefined;
		persistUser(user);
		this.initPromise = Promise.resolve();
		// Each new AuthSession round must re-do Google step-up when enrolled.
		try {
			await clearMfaOk();
		} catch {
			/* BFF unreachable — cookie may linger; /auth/me + guards still enforce */
		}
		return user;
	}

	async logout(): Promise<void> {
		invalidateAuthStatusRequest();
		try {
			try {
				await clearMfaOk();
			} catch {
				/* ignore */
			}
			await sessionLogout();
		} finally {
			this.state.user = null;
			this.clearNeedsReauth();
			shelterStore.selectedShelterCode = undefined;
			persistUser(null);
			this.initPromise = null;
			invalidateAuthStatusRequest();
		}
	}

	/** Sync cached session display name after self-profile save (header / portal). */
	setDisplayName(displayName: string): void {
		if (!this.state.user) return;
		const trimmed = displayName.trim();
		const next = { ...this.state.user, display_name: trimmed || null };
		this.state.user = next;
		persistUser(next);
	}
}

export const authStore = new AuthStore();
