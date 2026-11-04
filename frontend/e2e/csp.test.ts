/**
 * Content-Security-Policy (svelte.config.js `kit.csp`) — the app's script lockdown.
 *
 * The policy exists so an injected script cannot run and read the remembered volunteer
 * token in localStorage (#625). These tests prove both halves: an injected inline script
 * really is blocked, and the pages that lean on the riskiest browser features — the
 * maplibre map (blob: worker), the camera QR scanner — still work with no violation.
 *
 * Violations are collected from `securitypolicyviolation` events, registered before any
 * page script runs.
 */
import { test, expect, type Page } from '@playwright/test';
import { fakeCameraArgs, writeQrVideo } from './helpers/fake-camera';
import { BASE, DASHBOARD, TOKEN, mockPortal } from './helpers/volunteer-portal';

test.use({ launchOptions: { args: fakeCameraArgs(writeQrVideo(TOKEN, 'csp-ticket')) } });

async function watchViolations(page: Page) {
	await page.addInitScript(() => {
		const seen: string[] = [];
		(window as unknown as { __csp: string[] }).__csp = seen;
		document.addEventListener('securitypolicyviolation', (event) =>
			seen.push(`${event.violatedDirective} ${event.blockedURI}`)
		);
	});
	return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test('sends a nonce-based script policy, never unsafe-inline', async ({ request }) => {
	const response = await request.get(`${BASE}/volunteers`);
	const csp = response.headers()['content-security-policy'] ?? '';
	expect(csp).toMatch(/script-src [^;]*'nonce-/);
	expect(csp).not.toContain('unsafe-inline');
	expect(csp).not.toContain('unsafe-eval');
	expect(csp).toContain("object-src 'none'");
	expect(csp).toContain("frame-ancestors 'none'");
});

test('blocks a script injected into the page', async ({ page }) => {
	const violations = await watchViolations(page);
	await page.goto(`${BASE}/volunteers`);
	const ran = await page.evaluate(() => {
		const script = document.createElement('script');
		script.textContent = 'window.__injected = true';
		document.body.append(script);
		return (window as unknown as { __injected?: boolean }).__injected === true;
	});
	expect(ran).toBe(false);
	await expect.poll(violations).toContainEqual(expect.stringMatching(/^script-src/));
});

for (const path of ['/', '/volunteers', '/volunteers/jobs']) {
	test(`renders ${path} with no violation`, async ({ page }) => {
		const violations = await watchViolations(page);
		await page.goto(`${BASE}${path}`);
		await expect(page.locator('main').first()).toBeVisible();
		await page.waitForLoadState('networkidle');
		expect(await violations()).toEqual([]);
	});
}

test('draws the shelter map — its blob: worker included — with no violation', async ({ page }) => {
	const violations = await watchViolations(page);
	await page.goto(`${BASE}/shelters`);
	await expect(page.locator('.maplibregl-canvas').first()).toBeVisible({ timeout: 15_000 });
	await page.waitForLoadState('networkidle');
	expect(await violations()).toEqual([]);
});

test('scans a pass with the camera and signs in, with no violation', async ({ page }) => {
	const violations = await watchViolations(page);
	await mockPortal(page);
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();
	await expect(page).toHaveURL(DASHBOARD, { timeout: 15_000 });
	expect(await violations()).toEqual([]);
});
