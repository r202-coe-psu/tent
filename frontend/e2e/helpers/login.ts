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
import { COUCH_BASE, type TestUser } from './couch';
import { appBaseUrl } from './e2e-env';

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
	const appBase = appBaseUrl();
	// 1. Set the AuthSession cookie for the app host (no port — sent to all ports).
	await page.context().addCookies([
		{
			name: 'AuthSession',
			value: authSession,
			domain: new URL(appBase).hostname,
			path: '/',
			httpOnly: false,
			secure: false,
			sameSite: 'Lax'
		}
	]);

	// 2. Navigate to a neutral page first so localStorage is accessible.
	//    We use `/login` (always accessible) but immediately set localStorage before
	//    any redirects fire. We must visit a page with the correct origin first.
	await page.goto(`${appBase}/login`, { waitUntil: 'domcontentloaded' });

	// 3. Set localStorage with the user identity so authStore.loadCachedUser() succeeds.
	const sessionUser = { name: user.name, roles: user.roles };
	await page.evaluate((u) => {
		localStorage.setItem('auth:user', JSON.stringify(u));
	}, sessionUser);
}

/**
 * The test build talks to CouchDB cross-origin (:4173 → :5984), so staff pages show
 * the "cannot connect" banner. Forward the browser's CouchDB calls through the
 * preview server's same-origin `/couch` proxy — the path nginx provides in
 * production. Transport only: responses come from the real CouchDB, nothing is
 * mocked. Call before the first navigation.
 */
export async function routeBrowserCouchThroughApp(page: Page): Promise<void> {
	const appBase = appBaseUrl();
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const target = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': appBase,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		const response = await route
			.fetch({ url: `${appBase}/couch${target.pathname}${target.search}` })
			.catch(() => null);
		// The page navigated or closed mid-request (e.g. a _changes long-poll) — nothing
		// left to answer, whether that happened during the fetch or before the fulfill.
		if (!response) return;
		await route
			.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } })
			.catch(() => undefined);
	});
}

/**
 * Clear the injected session (cookie + localStorage).
 */
export async function clearSession(page: Page): Promise<void> {
	await page.context().clearCookies();
	await page
		.evaluate(() => {
			localStorage.removeItem('auth:user');
		})
		.catch(() => {
			// Ignore if page hasn't navigated yet
		});
}
