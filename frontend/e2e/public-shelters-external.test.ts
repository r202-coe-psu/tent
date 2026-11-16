/**
 * E2E (mock): public shelter directory shows an external shelter (CR-252 FR-20..23).
 *
 * Every API boundary is mocked — no CouchDB / Mongo / FastAPI needed. Covers the gray
 * "ไม่ทราบสถานะ" chip + external-link icon, the constant "ติดต่อ ณ ศูนย์พักพิง" text in place of
 * capacity, the hidden pre-register button, and the status filter reaching the API as
 * `status=unknown`.
 */
import { test, expect, type Page } from '@playwright/test';

const EXTERNAL_URL = 'https://example.org/shelters/ext-1';

const SHELTERS = {
	shelters: [
		{
			code: 'SH001',
			name: 'ศูนย์พักพิง E2E ปกติ',
			status: 'open',
			capacity: 200,
			accepts_pre_registration: true,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'คอหงส์',
			geo: { lat: 7.0086, lng: 100.4747 },
			is_external: false,
			external_url: null
		},
		{
			code: 'EXT001',
			name: 'ศูนย์พักพิง E2E ภายนอก',
			status: 'unknown',
			capacity: 0,
			accepts_pre_registration: false,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'คอหงส์',
			geo: { lat: 7.0186, lng: 100.4847 },
			is_external: true,
			external_url: EXTERNAL_URL
		}
	],
	count: 2,
	as_of: '2026-11-12T03:00:00.000Z'
};

async function mockPublicApi(page: Page): Promise<{ listUrls: URL[] }> {
	const listUrls: URL[] = [];
	await page.route('**/api/public/v1/shelters**', (route) => {
		const url = new URL(route.request().url());
		if (url.pathname !== '/api/public/v1/shelters') return route.fallback();
		listUrls.push(url);
		const status = url.searchParams.get('status');
		const shelters = status === 'unknown' ? [SHELTERS.shelters[1]] : SHELTERS.shelters;
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ ...SHELTERS, shelters, count: shelters.length })
		});
	});
	await page.route('**/api/public/v1/config/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ types: [], groups: [] })
		})
	);
	return { listUrls };
}

test.describe('Public shelters: external shelter', { tag: ['@public', '@regression'] }, () => {
	test.use({ viewport: { width: 1440, height: 900 } });

	test('shows the gray unknown chip with a safe link, contact text, and no booking button', async ({
		page
	}) => {
		await mockPublicApi(page);
		await page.goto('/shelters');

		const external = page.locator('[data-shelter-code="EXT001"]');
		await expect(external).toBeVisible();

		const chip = external.getByTestId('external-shelter-chip');
		await expect(chip).toContainText('ไม่ทราบสถานะ');
		await expect(chip).toHaveAttribute('href', EXTERNAL_URL);
		await expect(chip).toHaveAttribute('target', '_blank');
		await expect(chip).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(chip.locator('svg')).toHaveCount(1);

		await expect(external.getByText('ติดต่อ ณ ศูนย์พักพิง')).toBeVisible();
		await expect(external.getByText('รองรับได้สูงสุด')).toHaveCount(0);
		await expect(external.getByRole('button', { name: 'ลงทะเบียนล่วงหน้า' })).toHaveCount(0);

		// A normal shelter keeps capacity and the booking button.
		const normal = page.locator('[data-shelter-code="SH001"]');
		await expect(normal.getByText('รองรับได้สูงสุด')).toBeVisible();
		await expect(normal.getByRole('button', { name: 'ลงทะเบียนล่วงหน้า' })).toBeVisible();
	});

	test('the status filter offers "ไม่ทราบสถานะ" and sends status=unknown', async ({ page }) => {
		const api = await mockPublicApi(page);
		await page.goto('/shelters');
		await expect(page.locator('[data-shelter-code="EXT001"]')).toBeVisible();

		await page.getByRole('button', { name: 'สถานะศูนย์' }).click();
		await page.getByRole('option', { name: 'ไม่ทราบสถานะ' }).click();

		await expect(page).toHaveURL(/status=unknown/);
		await expect(page.locator('[data-shelter-code="SH001"]')).toHaveCount(0);
		await expect(page.locator('[data-shelter-code="EXT001"]')).toBeVisible();
		expect(api.listUrls.some((u) => u.searchParams.get('status') === 'unknown')).toBe(true);
	});
});
