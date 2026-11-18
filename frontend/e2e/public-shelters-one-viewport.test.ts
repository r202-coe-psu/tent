/**
 * E2E (mock): the public shelter search fits in one viewport (#1419).
 *
 * Every API boundary is mocked — no CouchDB / Mongo / FastAPI needed. Fourteen shelters make the
 * lists far taller than the screen, so a page that still grew with its content would scroll.
 * Desktop keeps the metric cards above the map; mobile is the map or the list with nothing above.
 */
import { test, expect, type Page } from '@playwright/test';

const shelter = (n: number) => ({
	code: `SH${String(n).padStart(3, '0')}`,
	name: `ศูนย์พักพิง E2E ลำดับ ${n}`,
	status: n % 3 === 0 ? 'closed' : 'open',
	capacity: 100 + n,
	accepts_pre_registration: true,
	province: 'สงขลา',
	district: 'หาดใหญ่',
	subdistrict: 'คอหงส์',
	geo: { lat: 7.0 + n / 100, lng: 100.47 + n / 100 },
	is_external: false,
	external_url: null
});

const SHELTERS = Array.from({ length: 14 }, (_, i) => shelter(i + 1));

async function mockPublicApi(page: Page): Promise<void> {
	await page.route('**/api/public/v1/shelters**', (route) => {
		const url = new URL(route.request().url());
		if (url.pathname !== '/api/public/v1/shelters') return route.fallback();
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				shelters: SHELTERS,
				count: SHELTERS.length,
				as_of: '2026-11-18T03:00:00.000Z'
			})
		});
	});
	await page.route('**/api/public/v1/config/**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ types: [], groups: [] })
		})
	);
}

/** Page scroll height minus the window: 0 when everything is on screen. */
const pageOverflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

const TOTAL_CARD = 'ศูนย์พักพิงทั้งหมด';
/** The first paint of this client-rendered page can be slow on a cold server. */
const READY = { timeout: 20_000 };

test.describe('Public shelters: one viewport', { tag: ['@public', '@regression'] }, () => {
	test.describe('desktop', () => {
		test.use({ viewport: { width: 1440, height: 900 } });

		test('the page does not scroll: cards on top, the map takes the rest, no footer', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			await expect(page.getByText(TOTAL_CARD)).toBeVisible(READY);
			await expect(page.locator('[data-shelter-code="SH001"]')).toBeVisible(READY);

			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
			await expect(page.locator('footer')).toHaveCount(0);
		});

		test('the shelter list scrolls inside its own panel', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const first = page.locator('[data-shelter-code="SH001"]');
			await expect(first).toBeVisible(READY);

			const scroller = page.locator('.custom-scrollbar').filter({ has: first });
			const { scrollable } = await scroller.evaluate((el) => ({
				scrollable: el.scrollHeight > el.clientHeight
			}));
			expect(scrollable).toBe(true);
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
		});
	});

	test.describe('mobile', () => {
		test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

		test('map view: no cards above, no page scroll', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			await expect(page.getByRole('button', { name: /รายการ/ }).first()).toBeVisible(READY);

			await expect(page.getByText(TOTAL_CARD)).toBeHidden();
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
			await expect(page.locator('footer')).toHaveCount(0);
		});

		test('list view: no cards above, the list scrolls inside, the page does not', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			await page
				.getByRole('button', { name: /รายการ/ })
				.first()
				.click();
			const firstCard = page.locator('[id^="shelter-card-mobile-"]').first();
			await expect(firstCard).toBeVisible(READY);

			// The list is its own scroller, so it is taller than its box while the page is not.
			const scroller = page.locator('div.overflow-y-auto').filter({ has: firstCard });
			expect(await scroller.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
			await expect(page.getByText(TOTAL_CARD)).toBeHidden();
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
		});
	});
});
