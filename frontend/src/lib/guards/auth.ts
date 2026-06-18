import { authStore } from '$lib/stores/auth.svelte';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';
import { isShelterManager, isSystemAdmin } from '$lib/auth/roles';

/** Where a freshly-authenticated user (or an already-authed visitor to an auth page) lands. */
export const LANDING_ROUTE = '/';

/** The login page — where unauthenticated and just-logged-out users are sent. */
export const LOGIN_ROUTE = '/login';

/**
 * Auth guard for protected routes. Resolves the CouchDB `_session` cookie and
 * redirects to /login when there is no authenticated user.
 *
 * @example
 * // src/routes/(protected)/+layout.ts
 * import { requireAuth } from '$lib/guards/auth';
 * export const load = async () => {
 *   await requireAuth();
 *   return {};
 * };
 */
export async function requireAuth() {
	if (!browser) return;

	await authStore.ensureInitialized();

	if (!authStore.isAuthenticated) {
		throw redirect(302, resolve(LOGIN_ROUTE));
	}
}

/**
 * Admin guard — requires a system admin (`system_admin` or the CouchDB `_admin`).
 * Redirects to / when authenticated but not an admin.
 */
export async function requireAdmin() {
	await requireAuth();
	if (!isSystemAdmin(authStore.user?.roles ?? [])) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Manager guard — requires a system admin OR a shelter_manager. Used by the
 * user-management page (the BFF is the real authorization gate; this is UX).
 */
export async function requireManager() {
	await requireAuth();
	const roles = authStore.user?.roles ?? [];
	if (!isSystemAdmin(roles) && !isShelterManager(roles)) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}

/**
 * Redirect away from auth pages (login) when a session already exists.
 *
 * @example
 * // src/routes/login/+page.ts
 * import { redirectIfAuthenticated } from '$lib/guards/auth';
 * export const load = async () => {
 *   await redirectIfAuthenticated();
 *   return {};
 * };
 */
export async function redirectIfAuthenticated(redirectTo: typeof LANDING_ROUTE = LANDING_ROUTE) {
	if (!browser) return;

	await authStore.ensureInitialized();

	// Allow the login page through when the sync session has expired, so the
	// user can re-authenticate even though a cached identity still exists.
	if (authStore.isAuthenticated && !authStore.needsReauth) {
		throw redirect(302, resolve(redirectTo));
	}
}
