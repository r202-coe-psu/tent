import { test, expect, type Page } from '@playwright/test';
import { createCouchUser, deleteCouchUser, SA_ROLES } from './helpers/couch';

const RUN_ID = Date.now().toString(36);
const VALID = { username: `login_test_${RUN_ID}`, password: 'Password1!', roles: SA_ROLES, display_name: 'Login Test User' };
const INVALID = { username: 'wrong', password: 'wrongpass' };

test.describe('Login', () => {
	test.beforeAll(async () => {
		await createCouchUser({
			name: VALID.username,
			password: VALID.password,
			roles: VALID.roles,
			display_name: VALID.display_name
		});
	});

	test.afterAll(async () => {
		await deleteCouchUser(VALID.username);
	});

	test('shows login form', async ({ page }) => {
		await page.goto('/login');
		await expect(page.getByLabel('Username')).toBeVisible();
		await expect(page.getByLabel('Password')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Login' })).toBeVisible();
	});

	/**
	 * Simulates the production reverse-proxy (Nginx) behavior in Playwright.
	 * intercepts `**\/_session`, forwards to CouchDB, and maps the cross-origin
	 * `Set-Cookie` into the local Playwright context.
	 */
	async function mockProxy(page: Page) {
		await page.route('**/_session', async (route) => {
			if (route.request().method() === 'POST') {
				const body = route.request().postDataJSON();
				const res = await fetch('http://localhost:5984/_session', {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify(body)
				});
				const data = await res.json();
				if (res.ok) {
					const cookieStr = res.headers.get('set-cookie') || '';
					const match = cookieStr.match(/AuthSession=([^;]+)/);
					if (match) {
						await page.context().addCookies([
							{ name: 'AuthSession', value: match[1], domain: 'localhost', path: '/' }
						]);
					}
				}
				await route.fulfill({ status: res.status, contentType: 'application/json', body: JSON.stringify(data) });
			} else {
				await route.continue();
			}
		});
	}

	test('redirects to / on valid credentials', async ({ page }) => {
		await mockProxy(page);
		await page.goto('/login');
		await page.getByLabel('Username').fill(VALID.username);
		await page.getByLabel('Password').fill(VALID.password);
		await page.getByRole('button', { name: 'Login' }).click();
		
		await page.waitForURL((url) => !url.pathname.includes('/login'), { timeout: 8000 });
		await expect(page).toHaveURL('/');
	});

	test('shows error toast on invalid credentials', async ({ page }) => {
		await mockProxy(page);
		await page.goto('/login');
		await page.getByLabel('Username').fill(INVALID.username);
		await page.getByLabel('Password').fill(INVALID.password);
		await page.getByRole('button', { name: 'Login' }).click();
		
		// CouchDB returns "name or password is incorrect"
		// The UI renders it inside a toast
		await expect(page.getByText(/incorrect|failed/i)).toBeVisible({ timeout: 5000 });
	});
});
