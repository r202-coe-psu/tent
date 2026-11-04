/**
 * Volunteer portal sign-in by scanning a ticket QR (#625).
 *
 * The in-page scanner is real: Chromium plays a QR video as its camera
 * (`helpers/fake-camera.ts`), so html5-qrcode decodes it the way it would a phone camera.
 * Only the BFF answers are mocked. Launch options are per file, hence a separate file for
 * the "not a ticket" camera (`volunteer-portal-remember.test.ts`).
 */
import { test, expect } from '@playwright/test';
import { fakeCameraArgs, writeQrVideo } from './helpers/fake-camera';
import { BASE, DASHBOARD, TOKEN, mockPortal, remembered } from './helpers/volunteer-portal';

test.use({ launchOptions: { args: fakeCameraArgs(writeQrVideo(TOKEN, 'ticket')) } });

test('signs in on the scan alone, and remembers nothing unless asked', async ({ page }) => {
	const resolveCalls = await mockPortal(page);
	await page.goto(`${BASE}/volunteers/portal`);
	await page.getByRole('button', { name: 'สแกน QR ตั๋ว / รหัส Token' }).click();

	// No "เข้าสู่ระบบ" press — the scan itself signs in.
	await expect(page).toHaveURL(DASHBOARD, { timeout: 15_000 });
	expect(resolveCalls[0]).toEqual({ token: TOKEN });
	expect(await remembered(page)).toBeNull();
});
