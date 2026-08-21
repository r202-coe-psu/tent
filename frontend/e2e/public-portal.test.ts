import { test, expect } from '@playwright/test';

test.describe('Public Portal - Social and Contact Links', () => {
	test('displays default emergency phone links', async ({ page }) => {
		// Mock the config API to return NO dynamic config data
		await page.route('**/api/public/v1/config/faqs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ faqs: [] })
			});
		});

		await page.goto('http://localhost:4173/');

		// Verify 1669 and 1784 emergency links are always visible
		const phone1669 = page.locator('a[href="tel:1669"]');
		await expect(phone1669).toBeVisible();

		const phone1784 = page.locator('a[href="tel:1784"]');
		await expect(phone1784).toBeVisible();

		// The dynamic links should NOT be visible
		await expect(page.locator('text=สอบถามข้อมูลเพิ่มเติม')).not.toBeVisible();
	});

	test('displays dynamic contact links when provided by config', async ({ page }) => {
		// Mock the config API with dynamic contact info
		await page.route('**/api/public/v1/config/faqs', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					faqs: [],
					phone_number: '0812345678',
					line_oa_url: 'https://line.me/ti/p/test',
					facebook_url: 'https://fb.com/test'
				})
			});
		});

		await page.goto('http://localhost:4173/');

		// Verify section title is present
		await expect(page.locator('text=สอบถามข้อมูลเพิ่มเติม')).toBeVisible();

		// Verify dynamic phone link
		const customPhone = page.locator('a[href="tel:0812345678"]');
		await expect(customPhone).toBeVisible();
		await expect(customPhone).toContainText('โทร 0812345678');

		// Verify Line OA link
		const lineLink = page.locator('a[href="https://line.me/ti/p/test"]');
		await expect(lineLink).toBeVisible();

		// Verify Facebook link
		const fbLink = page.locator('a[href="https://fb.com/test"]');
		await expect(fbLink).toBeVisible();
	});
});
