import { expect, test, type Page, type Response } from '@playwright/test';

const LOGIN_PATH = '/login';
const PORTAL_PATH = '/portal';
const FORCE_SETUP_PATH = '/force-setup';
const MFA_CHALLENGE_PATH = '/mfa-challenge';

function requiredCredential(name: 'E2E_USERNAME' | 'E2E_PASSWORD'): string {
	const value = process.env[name];
	if (!value) {
		throw new Error(`${name} is required for the authenticated Staging smoke test`);
	}
	return value;
}

async function installCaptchaVerificationMock(page: Page): Promise<() => number> {
	let verificationRequests = 0;

	await page.addInitScript(() => {
		window.__captchaToken = 'staging-e2e-captcha-token';
	});
	await page.route('**/api/v1/auth/captcha/verify', async (route) => {
		if (route.request().method() !== 'POST') {
			await route.continue();
			return;
		}

		verificationRequests += 1;
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ok: true })
		});
	});

	return () => verificationRequests;
}

async function fillPasswordWithoutReportingValue(page: Page, password: string): Promise<void> {
	let secret = password;
	await page.exposeFunction('__readStagingE2EPassword', () => {
		const value = secret;
		secret = '';
		return value;
	});
	await page.getByLabel(/Password/i).evaluate(async (input) => {
		const value = await (
			window as typeof window & { __readStagingE2EPassword: () => Promise<string> }
		).__readStagingE2EPassword();
		const element = input as HTMLInputElement;
		element.focus();
		element.value = value;
		element.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
		element.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
	});
}

test.describe('Staging smoke', () => {
	test('health endpoint returns the exact frontend readiness payload', async ({ request }) => {
		const response = await request.get('/api/health');

		expect(response.status()).toBe(200);
		expect(await response.json()).toEqual({ ok: true, service: 'frontend' });
	});

	test('login page renders the credential form', async ({ page }) => {
		await page.goto(LOGIN_PATH);

		await expect(page.getByLabel(/^Username/i)).toBeVisible();
		await expect(page.getByLabel(/Password/i)).toBeVisible();
		await expect(page.getByRole('button', { name: /Login/i })).toBeVisible();
	});

	test('authenticates through the real Staging session and reaches the portal', async ({
		page
	}) => {
		const username = requiredCredential('E2E_USERNAME');
		const password = requiredCredential('E2E_PASSWORD');
		const captchaStatusResponse = await page.request.get('/api/public/v1/recaptcha');
		expect(captchaStatusResponse.status()).toBe(200);
		const captchaStatus = (await captchaStatusResponse.json()) as { enabled: boolean };
		const captchaVerificationCount = await installCaptchaVerificationMock(page);
		let sessionResponse: Response | undefined;
		let profileResponse: Response | undefined;

		page.on('response', (response) => {
			const request = response.request();
			const path = new URL(response.url()).pathname;
			if (request.method() === 'POST' && path === '/couch/_session') {
				sessionResponse = response;
			}
			if (request.method() === 'GET' && path === '/api/v1/auth/me') {
				profileResponse = response;
			}
		});

		await page.goto(LOGIN_PATH);
		await page.getByLabel(/^Username/i).fill(username);
		await fillPasswordWithoutReportingValue(page, password);
		await page.getByRole('button', { name: /Login/i }).click();

		await expect
			.poll(() => sessionResponse?.status(), {
				message: 'Expected a successful real POST /couch/_session request'
			})
			.toBe(200);
		await expect
			.poll(() => profileResponse?.status(), {
				message: 'Expected a successful real GET /api/v1/auth/me request'
			})
			.toBe(200);

		await page.waitForURL(
			(url) => [PORTAL_PATH, FORCE_SETUP_PATH, MFA_CHALLENGE_PATH].includes(url.pathname),
			{ timeout: 30_000 }
		);

		const destination = new URL(page.url()).pathname;
		if (destination === FORCE_SETUP_PATH || destination === MFA_CHALLENGE_PATH) {
			throw new Error(
				`Staging E2E bot provisioning is incomplete: login redirected to ${destination}. ` +
					'Ensure the security question is set, must_change_password is false, and MFA is not enrolled.'
			);
		}

		expect(destination).toBe(PORTAL_PATH);
		expect(captchaVerificationCount()).toBe(captchaStatus.enabled ? 1 : 0);
		await expect(page).toHaveTitle('SmartShelter Thailand');
		await expect(page.getByRole('region', { name: 'บริบทการปฏิบัติงาน' })).toBeVisible();
	});
});
