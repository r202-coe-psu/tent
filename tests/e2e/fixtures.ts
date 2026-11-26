/**
 * Shared setup for browser journeys:
 *  - third-party scripts and the login CAPTCHA are stubbed (not under test, and they need
 *    keys a local stack does not have) — everything else talks to the real app and CouchDB;
 *  - `checkpoint` saves a full-page screenshot into the report under a readable name, so a
 *    reviewer can follow each step next to the video.
 */
import { test as base, expect, type Page, type TestInfo } from '@playwright/test';
import { createAccount, deleteAccount, type TestAccount } from '../lib/couch.ts';

const PSU_CONSENT_URL = /^https:\/\/web-consent\.psu\.ac\.th\//;

/** Same stubs frontend/e2e uses (login.test.ts, helpers/psu-consent.ts). */
async function stubThirdParty(page: Page): Promise<void> {
	await page.route(PSU_CONSENT_URL, (route) =>
		route.fulfill({ status: 200, contentType: 'application/javascript', body: '' })
	);
	await page.addInitScript(() => {
		(window as Window & { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
	});
	await page.route('**/api/v1/auth/captcha/verify', (route) =>
		route.request().method() === 'POST'
			? route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
			: route.continue()
	);
}

const shotCounts = new WeakMap<TestInfo, number>();

/** Screenshot the whole page and attach it to the report as `NN-<label>`. */
export async function checkpoint(page: Page, testInfo: TestInfo, label: string): Promise<void> {
	const count = (shotCounts.get(testInfo) ?? 0) + 1;
	shotCounts.set(testInfo, count);
	const name = `${String(count).padStart(2, '0')}-${label}`;
	const path = testInfo.outputPath(`${name}.png`);
	await page.screenshot({ path, fullPage: true });
	await testInfo.attach(name, { path, contentType: 'image/png' });
}

/**
 * Staff password sign-in page. `/login` shows the password form only when the public API
 * says password login is on (CR-141, `/api/public/v1/login-methods`); `/admin-login` always
 * shows it, so the journeys do not depend on that setting or on FastAPI running.
 */
export const PASSWORD_LOGIN = '/admin-login';

/** Sign in through the real password form and wait until the app leaves the login page. */
export async function signIn(page: Page, account: Pick<TestAccount, 'name' | 'password'>) {
	await page.goto(PASSWORD_LOGIN);
	await page.getByLabel('Username').fill(account.name);
	await page.getByLabel('Password').fill(account.password);
	await page.getByRole('button', { name: 'Login' }).click();
	await page.waitForURL((url) => url.pathname !== PASSWORD_LOGIN);
}

type Fixtures = {
	/** Mint a throwaway staff account that is past the first-login gate; removed after the test. */
	staffAccount: (label: string, roles: string[], displayName?: string) => Promise<TestAccount>;
};

export const test = base.extend<Fixtures>({
	page: async ({ page }, use) => {
		await stubThirdParty(page);
		await use(page);
	},
	// eslint-disable-next-line no-empty-pattern
	staffAccount: async ({}, use) => {
		const made: string[] = [];
		const run = Date.now().toString(36);
		await use(async (label, roles, displayName) => {
			const name = `permtest_ui_${label}_${run}`;
			made.push(name);
			return createAccount(name, roles, { displayName, firstLoginDone: true });
		});
		for (const name of made) await deleteAccount(name);
	}
});

export { expect };
