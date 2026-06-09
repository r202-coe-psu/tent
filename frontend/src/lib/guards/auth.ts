import { authStore } from '$lib/stores/auth.svelte';
import { redirect } from '@sveltejs/kit';
import { browser } from '$app/environment';
import { resolve } from '$app/paths';

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
		throw redirect(302, resolve('/login'));
	}
}

/**
 * Admin guard — requires an active `_admin` CouchDB session.
 * Redirects to /home when authenticated but not admin.
 */
export async function requireAdmin() {
	await requireAuth();
	if (!authStore.user?.roles.includes('_admin')) {
		throw redirect(302, resolve('/home'));
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
export async function redirectIfAuthenticated(redirectTo: '/notes' = '/notes') {
	if (!browser) return;

	await authStore.ensureInitialized();

	// Allow the login page through when the sync session has expired, so the
	// user can re-authenticate even though a cached identity still exists.
	if (authStore.isAuthenticated && !authStore.needsReauth) {
		throw redirect(302, resolve(redirectTo));
	}
}
