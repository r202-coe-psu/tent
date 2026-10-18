/**
 * Volunteer portal "จดจำเครื่องนี้" (#625) and the error for a QR that is not a ticket.
 *
 * The fake camera here shows a QR that is NOT a ticket, so the scanner never signs in on
 * its own and the remembered-device flow can be driven through the typed-token form.
 */
import { test, expect } from '@playwright/test';
import { fakeCameraArgs, writeQrVideo } from './helpers/fake-camera';
import {
	BASE,
	DASHBOARD,
	PORTAL_ID,
	REMEMBER_KEY,
	TOKEN,
	mockPortal,
	remembered
} from './helpers/volunteer-portal';

test.use({
	launchOptions: { args: fakeCameraArgs(writeQrVideo('https://example.com/menu', 'not-ticket')) }
});

test('a QR that is not a ticket says so', async ({ page }) => {
	await mockPortal(page);
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();

	await expect(page.getByText('QR Code นี้ไม่ใช่ตั๋วจิตอาสา').first()).toBeVisible({
		timeout: 15_000
	});
	await expect(page).toHaveURL(/\/volunteers\/portal$/);
});

test('a remembered device signs straight in from a new tab; sign-out forgets it', async ({
	page,
	context
}) => {
	await mockPortal(page);
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();
	await page.getByLabel('จดจำเครื่องนี้ 7 วัน').check();
	await page.getByLabel('กรอกรหัส Token หรือ รหัสตั๋วจิตอาสา').fill(TOKEN);
	await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
	await expect(page).toHaveURL(DASHBOARD);

	const record = JSON.parse((await remembered(page)) ?? 'null');
	expect(record).toMatchObject({ token: TOKEN, portal_id: PORTAL_ID });
	const days = (record.remembered_until - Date.now()) / 86_400_000;
	expect(days).toBeGreaterThan(6.9);
	expect(days).toBeLessThanOrEqual(7);

	// A new tab starts with an empty sessionStorage — only the remembered device can
	// sign it in.
	const tab = await context.newPage();
	await mockPortal(tab);
	await tab.goto(`${BASE}/volunteers/portal`);
	await expect(tab).toHaveURL(DASHBOARD);

	await tab.getByRole('button', { name: 'ออกจากระบบ / ลืมเครื่องนี้' }).click();
	await expect(tab.getByText('ออกจากระบบและลืมเครื่องนี้แล้ว')).toBeVisible();
	await expect(tab).toHaveURL(/\/volunteers\/portal$/);
	expect(await remembered(tab)).toBeNull();
});

test('a revoked token makes the remembered device forget itself', async ({ page }) => {
	let known = true;
	await mockPortal(page, () => known);
	await page.goto(`${BASE}/volunteers/portal`);
	await page.evaluate(
		([key, value]) => localStorage.setItem(key, value),
		[
			REMEMBER_KEY,
			JSON.stringify({
				token: TOKEN,
				portal_id: PORTAL_ID,
				remembered_until: Date.now() + 86_400_000
			})
		]
	);
	known = false; // the token was revoked / reissued since

	await page.goto(`${BASE}/volunteers/portal`);
	await expect(page.getByText(/เครื่องนี้ไม่ได้จดจำการเข้าสู่ระบบแล้ว/).first()).toBeVisible();
	await expect(page).toHaveURL(/\/volunteers\/portal$/);
	expect(await remembered(page)).toBeNull();
});
