import { test, expect, type Page } from '@playwright/test';

const TAGS = { tag: ['@regression', '@kiosk'] };

/** Answer the calls the method page makes. Banners 404: the idle reset must not need them. */
async function mockKioskBackend(page: Page) {
	await page.route('**/api/v1/kiosk/config', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				phone_check_in_enabled: true,
				walk_in_registration_enabled: false,
				thaid_check_in_enabled: false
			})
		})
	);
	await page.route('**/api/v1/kiosk/hardware', (route) =>
		route.fulfill({ status: 404, body: '{}' })
	);
	await page.route('**/api/v1/kiosk/banners', (route) =>
		route.fulfill({ status: 404, body: '{}' })
	);
}

test.describe('Kiosk language across routes', () => {
	test.beforeEach(async ({ page }) => {
		await page.clock.install();
		await mockKioskBackend(page);
	});

	test(
		'boot picks a language, it survives a flow, and a visit end resets it to Thai',
		TAGS,
		async ({ page }) => {
			await test.step('boot lands on the picker, keeping the kiosk context', async () => {
				await page.goto('/kiosk?shelter_code=SH001');
				await expect(page).toHaveURL(/\/kiosk\/language\?shelter_code=SH001$/);
				await expect(page.getByText('Choose your language')).toBeVisible();
			});

			await test.step('English turns the method page English', async () => {
				await page.locator('[data-language="en"]').click();
				// Only the context that came in: no Thai fallback names written into the URL.
				await expect(page).toHaveURL(/\/kiosk\?shelter_code=SH001$/);
				await expect(
					page.getByRole('heading', { name: 'Registration', exact: true })
				).toBeVisible();
				await expect(page.getByText('ศูนย์พักพิง')).toHaveCount(0);
			});

			await test.step('back home after a flow, English stays', async () => {
				await page.getByRole('link', { name: /Print QR/ }).click();
				await expect(page).toHaveURL(/\/kiosk\/print-qr\?shelter_code=SH001$/);
				await page.getByRole('link', { name: 'Back to start' }).click();
				await expect(page).toHaveURL(/\/kiosk\?shelter_code=SH001$/);
				await expect(
					page.getByRole('heading', { name: 'Registration', exact: true })
				).toBeVisible();
			});

			await test.step('a visit left idle inside a flow ends on the picker in Thai', async () => {
				await page.getByRole('link', { name: /Print QR/ }).click();
				await expect(page).toHaveURL(/\/kiosk\/print-qr\?shelter_code=SH001$/);
				await page.clock.fastForward(61_000);
				await expect(page).toHaveURL(/\/kiosk\/language\?shelter_code=SH001$/);
				await page.locator('[data-language="en"]').click();
				await expect(page).toHaveURL(/\/kiosk\?shelter_code=SH001$/);
			});

			await test.step('idle on the method page with no banners resets to Thai', async () => {
				await page.clock.fastForward(31_000);
				await expect(page).toHaveURL(/\/kiosk\/language\?shelter_code=SH001$/);
				await page.locator('[data-language="th"]').click();
				await expect(page.getByRole('heading', { name: 'ลงทะเบียน', exact: true })).toBeVisible();
			});
		}
	);
});
