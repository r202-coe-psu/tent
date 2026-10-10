/**
 * E2E: global non-dismissable "session expired" login modal (CONTRIBUTING.md §4).
 *
 * Fully browser-mocked (`page.route`): the CouchDB `_session` / data endpoints and the BFF
 * auth-status endpoints are answered by an in-test fake, so nothing real is read or written
 * and no CouchDB user is needed. The SvelteKit app itself runs from the preview build.
 *
 * Covers: 401 opens the modal once; it cannot be dismissed (Esc / overlay / no close button);
 * a valid-session 403 is a permission denial (no modal); network errors show the offline banner
 * only; re-login closes the modal in place; "another account" logs out; the original page is
 * restored after a post-login detour (MFA / force-setup).
 */
import { test, expect, type Page, type Route } from '@playwright/test';
import { appBaseUrl } from './helpers/e2e-env';

const COUCH = 'http://localhost:5984';
const USER = { name: 'e2e-session-user', roles: ['system_admin'] };
const PASSWORD = 'Correct-Horse-1!';

type Mode = 'ok' | 'expired-401' | 'forbidden-403' | 'network-down';

interface FakeBackend {
	/** What the shelter registry (`_all_docs`) answers. */
	setDataMode(mode: Mode): void;
	/** Whether the AuthSession cookie is still valid. */
	setSessionValid(valid: boolean): void;
	setPendingMfa(pending: boolean): void;
	readonly sessionGets: () => number;
	readonly loginPosts: () => number;
}

const json = (route: Route, status: number, body: unknown, headers: Record<string, string> = {}) =>
	route.fulfill({
		status,
		contentType: 'application/json',
		headers: { ...headers },
		body: JSON.stringify(body)
	});

async function installFakeBackend(page: Page): Promise<FakeBackend> {
	const appBase = appBaseUrl();
	const cors = {
		'access-control-allow-origin': appBase,
		'access-control-allow-credentials': 'true',
		'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
		'access-control-allow-headers': 'Content-Type, Accept'
	};
	let dataMode: Mode = 'ok';
	let sessionValid = true;
	let pendingMfa = false;
	let sessionGets = 0;
	let loginPosts = 0;

	// Same-origin BFF + public plane
	await page.route('**/api/public/v1/recaptcha', (r) => json(r, 200, { enabled: false }));
	await page.route('**/api/public/v1/login-methods', (r) =>
		json(r, 200, { password: true, google: false, thaid: false })
	);
	await page.route('**/api/v1/me', (r) => json(r, 404, { error: { code: 'NOT_FOUND' } }));
	await page.route('**/api/v1/auth/me', (r) =>
		json(r, 200, {
			name: USER.name,
			roles: USER.roles,
			must_change_password: false,
			has_security_question: true,
			pending_mfa: pendingMfa
		})
	);
	await page.route('**/api/v1/auth/mfa**', (r) => json(r, 200, { ok: true }));

	// CouchDB (cross-origin in the test build): answer preflights, then the fake.
	await page.route(`${COUCH}/**`, async (route) => {
		const req = route.request();
		if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
		const url = new URL(req.url());
		const path = url.pathname;
		const reply = (status: number, body: unknown) => json(route, status, body, cors);

		if (path === '/_session') {
			if (req.method() === 'POST') {
				loginPosts += 1;
				const body = req.postDataJSON() as { name: string; password: string };
				if (body.name === USER.name && body.password === PASSWORD) {
					sessionValid = true;
					return reply(200, { ok: true, name: USER.name, roles: USER.roles });
				}
				return reply(401, { error: 'unauthorized', reason: 'Name or password is incorrect.' });
			}
			if (req.method() === 'DELETE') {
				sessionValid = false;
				return reply(200, { ok: true });
			}
			sessionGets += 1;
			return reply(200, {
				ok: true,
				userCtx: sessionValid ? { name: USER.name, roles: USER.roles } : { name: null, roles: [] }
			});
		}
		if (path === '/_up') return reply(200, { status: 'ok' });
		if (path.endsWith('/_changes')) return reply(200, { results: [], last_seq: '0' });

		if (dataMode === 'network-down') return route.abort('connectionrefused');
		if (dataMode === 'expired-401') return reply(401, { error: 'unauthorized' });
		if (dataMode === 'forbidden-403')
			return reply(403, { error: 'forbidden', reason: 'You are not allowed to access this db.' });
		if (path.endsWith('/_all_docs')) return reply(200, { rows: [] });
		return reply(200, {});
	});

	return {
		setDataMode: (m) => (dataMode = m),
		setSessionValid: (v) => (sessionValid = v),
		setPendingMfa: (p) => (pendingMfa = p),
		sessionGets: () => sessionGets,
		loginPosts: () => loginPosts
	};
}

async function openAsSignedIn(page: Page, path: string): Promise<void> {
	await page.goto('/login', { waitUntil: 'domcontentloaded' });
	await page.evaluate((u) => localStorage.setItem('auth:user', JSON.stringify(u)), USER);
	await page.goto(path);
}

const modal = (page: Page) => page.getByRole('alertdialog');

test.describe('Session expired modal', () => {
	test('a 401 opens one non-dismissable modal; re-login closes it in place', async ({ page }) => {
		const backend = await installFakeBackend(page);
		backend.setDataMode('expired-401');
		await openAsSignedIn(page, '/back-office/shelters');

		await expect(modal(page)).toBeVisible();
		await expect(modal(page)).toHaveCount(1);
		await expect(modal(page).getByText('เซสชันหมดอายุ', { exact: true })).toBeVisible();
		await expect(modal(page).getByText('กรุณาเข้าสู่ระบบอีกครั้งเพื่อทำงานต่อ')).toBeVisible();
		await expect(page.getByText('ข้อมูลบนหน้านี้ยังอยู่')).toHaveCount(0);

		// Focus lands on the password field when the modal opens.
		await expect(modal(page).locator('input[type="password"]')).toBeFocused();

		// Cannot be dismissed: no close control, Escape and an outside click are ignored.
		await expect(modal(page).getByRole('button', { name: /close|ปิด/i })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(modal(page)).toBeVisible();
		await page.mouse.click(5, 5);
		await expect(modal(page)).toBeVisible();

		// Username is pre-filled and read-only.
		const username = modal(page).getByLabel('Username หรือเบอร์โทรศัพท์');
		await expect(username).toHaveValue(USER.name);
		await expect(username).toHaveJSProperty('readOnly', true);

		// Wrong password keeps the modal open.
		const password = modal(page).locator('input[type="password"]');
		await password.fill('wrong-password');
		await modal(page).getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
		await expect.poll(() => backend.loginPosts()).toBe(1);
		await expect(modal(page)).toBeVisible();

		// Correct password closes it and keeps the user on the same page.
		backend.setDataMode('ok');
		await password.fill(PASSWORD);
		await modal(page).getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
		await expect(modal(page)).toHaveCount(0);
		await expect(page).toHaveURL(/\/back-office\/shelters/);
	});

	test('a 403 with a still-valid session is a permission denial, not expiry', async ({ page }) => {
		const backend = await installFakeBackend(page);
		backend.setDataMode('forbidden-403');
		await openAsSignedIn(page, '/back-office/shelters');

		// The 403 is confirmed against /_session (initial refresh + the verification).
		await expect.poll(() => backend.sessionGets()).toBeGreaterThanOrEqual(2);
		await page.waitForTimeout(500);
		await expect(modal(page)).toHaveCount(0);
	});

	test('a 403 for a session that is really gone opens the modal', async ({ page }) => {
		const backend = await installFakeBackend(page);
		await openAsSignedIn(page, '/back-office/shelters');
		await expect(modal(page)).toHaveCount(0);

		backend.setSessionValid(false);
		backend.setDataMode('forbidden-403');
		await page.evaluate(() => window.dispatchEvent(new Event('online')));
		await expect(modal(page)).toBeVisible();
	});

	test('network errors show the offline banner only, never the modal', async ({ page }) => {
		const backend = await installFakeBackend(page);
		backend.setDataMode('network-down');
		await openAsSignedIn(page, '/back-office/shelters');

		await expect(page.getByText('เชื่อมต่อเซิร์ฟเวอร์ไม่ได้').first()).toBeVisible({
			timeout: 15_000
		});
		await expect(modal(page)).toHaveCount(0);
	});

	test('"log in with another account" signs out and goes to /login', async ({ page }) => {
		const backend = await installFakeBackend(page);
		backend.setDataMode('expired-401');
		await openAsSignedIn(page, '/back-office/shelters');
		await expect(modal(page)).toBeVisible();

		await modal(page).getByRole('button', { name: 'เข้าสู่ระบบด้วยบัญชีอื่น' }).click();
		await expect(page).toHaveURL(/\/login$/);
		await expect(modal(page)).toHaveCount(0);
	});

	test('returns to the original page after a post-login detour (MFA / force-setup)', async ({
		page
	}) => {
		const backend = await installFakeBackend(page);
		backend.setDataMode('expired-401');
		await openAsSignedIn(page, '/back-office/shelters');
		await expect(modal(page)).toBeVisible();

		// The account is enrolled in MFA: the fresh login must pass the challenge first.
		backend.setPendingMfa(true);
		backend.setDataMode('ok');
		await modal(page).locator('input[type="password"]').fill(PASSWORD);
		await modal(page).getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
		await expect(page).toHaveURL(/\/mfa-challenge/);

		// The challenge ends at /portal; the stashed page is restored from there.
		backend.setPendingMfa(false);
		await page.goto('/portal');
		await expect(page).toHaveURL(/\/back-office\/shelters/);
	});
});
