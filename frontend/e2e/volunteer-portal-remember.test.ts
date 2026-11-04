/**
 * Volunteer portal "จดจำเครื่องนี้" (#625), the error for a QR that is not a ticket, and
 * reading a QR from an image file.
 *
 * The fake camera here shows a QR that is NOT a ticket, so the scanner never signs in on
 * its own and the remembered-device flow can be driven through the typed-token form.
 */
import { test, expect, type Page } from '@playwright/test';
import QRCode from 'qrcode';
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

/** A 1×1 white PNG — an image with no QR in it. */
const BLANK_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
	'base64'
);

async function openScanTab(page: Page) {
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();
	await expect(page.getByRole('button', { name: 'เลือกรูป QR จากเครื่อง' })).toBeVisible();
}

test('a QR image chosen from the device signs in, decoded in the browser', async ({ page }) => {
	await mockPortal(page);
	const uploads: string[] = [];
	page.on('request', (request) => {
		if (request.method() !== 'GET' && (request.postData() ?? '').includes('PNG')) {
			uploads.push(request.url());
		}
	});
	await openScanTab(page);

	await page.locator('input[type="file"]').setInputFiles({
		name: 'ticket.png',
		mimeType: 'image/png',
		buffer: await QRCode.toBuffer(TOKEN, { margin: 4, width: 400 })
	});

	await expect(page).toHaveURL(DASHBOARD, { timeout: 15_000 });
	// The image itself never leaves the device — only the decoded token is sent.
	expect(uploads).toEqual([]);
});

test('an image with no QR in it says so', async ({ page }) => {
	await mockPortal(page);
	await openScanTab(page);

	await page
		.locator('input[type="file"]')
		.setInputFiles({ name: 'blank.png', mimeType: 'image/png', buffer: BLANK_PNG });

	await expect(page.getByText('อ่าน QR จากรูปนี้ไม่ได้')).toBeVisible();
	await expect(page).toHaveURL(/\/volunteers\/portal$/);
});

test('a file that is not an image is refused before anything reads it', async ({ page }) => {
	await mockPortal(page);
	await openScanTab(page);

	await page.locator('input[type="file"]').setInputFiles({
		name: 'notes.txt',
		mimeType: 'text/plain',
		buffer: Buffer.from(TOKEN)
	});

	await expect(page.getByText('ไฟล์นี้ไม่ใช่รูปภาพ')).toBeVisible();
	await expect(page).toHaveURL(/\/volunteers\/portal$/);
});

/** Sign in with the typed-token form, optionally ticking "จดจำเครื่องนี้". */
async function signInWithToken(page: Page, remember: boolean) {
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();
	if (remember) await page.getByLabel('จดจำเครื่องนี้ 7 วัน').check();
	await page.getByLabel('กรอกรหัส Token หรือ รหัสตั๋วจิตอาสา').fill(TOKEN);
	await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
	await expect(page).toHaveURL(DASHBOARD);
}

const MINUTE = 60_000;
const SIGN_IN = /\/volunteers\/portal$/;

test('without "remember", a token session still ends after 30 minutes', async ({ page }) => {
	await page.clock.install();
	await mockPortal(page);
	await signInWithToken(page, false);
	expect(await remembered(page)).toBeNull();

	await page.clock.fastForward(29 * MINUTE);
	await page.reload();
	await expect(page).toHaveURL(DASHBOARD);

	await page.clock.fastForward(2 * MINUTE);
	await page.reload();
	await expect(page).toHaveURL(SIGN_IN);
	expect(await remembered(page)).toBeNull();
});

test('with "remember", the device signs back in past 30 minutes, but not past 7 days', async ({
	page
}) => {
	await page.clock.install();
	await mockPortal(page);
	await signInWithToken(page, true);

	// The 30-minute session is over — the remembered device signs straight back in.
	await page.clock.fastForward(31 * MINUTE);
	await page.reload();
	await expect(page).toHaveURL(DASHBOARD);
	expect(await remembered(page)).not.toBeNull();

	// Seven days on, the remembered device is forgotten and the sign-in screen is back.
	await page.clock.fastForward(7 * 24 * 60 * MINUTE);
	await page.reload();
	await expect(page).toHaveURL(SIGN_IN);
	expect(await remembered(page)).toBeNull();
});
