/**
 * Session injection helper for E2E UI tests.
 *
 * WHY NOT loginViaUI()?
 * The app calls CouchDB directly from the browser (cross-origin: port 4173 → port 5984).
 * Even with CORS enabled, `Set-Cookie` from CouchDB cannot be set for `localhost:4173`
 * by a response from `localhost:5984` (different port = different origin for cookies).
 *
 * WHY THIS APPROACH WORKS:
 * The `authStore` in auth.svelte.ts:
 *   1. Reads identity from `localStorage` on startup (loadCachedUser).
 *   2. Validates against `/_session` in the background (getSession).
 *
 * The SvelteKit BFF (authorizeUserWrite) reads the `Cookie` header from the incoming
 * HTTP request (server-side forwarding, not browser-side). The browser sends the
 * `AuthSession` cookie to `localhost:4173` if it's set for domain `localhost`.
 *
 * So we need to:
 *   1. Set the `AuthSession` cookie for domain `localhost` (sent to all localhost ports).
 *   2. Set `localStorage['auth:user']` so the auth store loads the correct user immediately.
 *   3. Navigate directly to the target page (bypassing the login form entirely).
 *
 * The BFF receives the cookie and forwards it to CouchDB for authorization.
 */

import type { Page } from '@playwright/test';
import type { TestUser } from './couch';

/**
 * Inject session for a test user into the browser context.
 * Call AFTER `createCouchUser` and `couchLogin` in beforeAll/beforeEach.
 *
 * @param page        Playwright page.
 * @param user        The TestUser object (name, roles).
 * @param authSession The AuthSession cookie value from `couchLogin()`.
 */
export async function injectSession(
	page: Page,
	user: Pick<TestUser, 'name' | 'roles'>,
	authSession: string
): Promise<void> {
	// 1. Set the AuthSession cookie for domain `localhost` (no port — sent to all ports).
	await page.context().addCookies([
		{
			name: 'AuthSession',
			value: authSession,
			domain: 'localhost',
			path: '/',
			httpOnly: false,
			secure: false,
			sameSite: 'Lax'
		}
	]);

	// 2. Navigate to a neutral page first so localStorage is accessible.
	//    We use `/login` (always accessible) but immediately set localStorage before
	//    any redirects fire. We must visit a page with the correct origin first.
	await page.goto('http://localhost:4173/login', { waitUntil: 'domcontentloaded' });

	// 3. Set localStorage with the user identity so authStore.loadCachedUser() succeeds.
	const sessionUser = { name: user.name, roles: user.roles };
	await page.evaluate((u) => {
		localStorage.setItem('auth:user', JSON.stringify(u));
	}, sessionUser);
}

/**
 * Clear the injected session (cookie + localStorage).
 */
export async function clearSession(page: Page): Promise<void> {
	await page.context().clearCookies();
	await page.evaluate(() => {
		localStorage.removeItem('auth:user');
	}).catch(() => {
		// Ignore if page hasn't navigated yet
	});
}
