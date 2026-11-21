/**
 * E2E (mock): the public shelter search fits in one viewport (#1419).
 *
 * Every API boundary is mocked — no CouchDB / Mongo / FastAPI needed. Fourteen shelters make the
 * lists far taller than the screen, so a page that still grew with its content would scroll.
 * Desktop keeps the metric cards above the map; mobile is the map or the list with nothing above.
 * The map legend keeps every label on one line (it wraps between items, never inside one).
 * Mobile map view shows the active filter chips (#1460); at 1024px the legend folds into a toggle
 * while both floating panels are open (#1461).
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

		test('the radius filter is one line: heading, presets, custom field and unit in one row', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const row = page.locator('[data-testid="radius-row"]:visible');
			await expect(row).toBeVisible(READY);

			const m = await row.evaluate((el) => {
				const box = el.getBoundingClientRect();
				const inside = [...el.children]
					.filter((c) => !(c instanceof HTMLInputElement && c.type === 'hidden'))
					.map((c) => c.getBoundingClientRect());
				const heading = el.previousElementSibling as HTMLElement;
				return {
					// every control sits within the row's own height: nothing wrapped below it
					wrapped: inside.some((r) => r.bottom > box.bottom + 1 || r.top < box.top - 1),
					overflows: el.scrollWidth > el.clientWidth + 1,
					headingLines: Math.round(
						heading.getBoundingClientRect().height /
							parseFloat(getComputedStyle(heading).lineHeight)
					),
					buttons: el.querySelectorAll('button[aria-pressed]').length
				};
			});
			expect(m.wrapped).toBe(false);
			expect(m.overflows).toBe(false);
			expect(m.headingLines).toBe(1);
			expect(m.buttons).toBe(5);
		});

		test('every map legend label stays on one line', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const legend = page.getByTestId('map-legend');
			await expect(legend.getByText('ไม่ทราบสถานะ')).toBeVisible(READY);

			const labels = await legend.evaluate((root) =>
				[...root.querySelectorAll('span')]
					.filter((el) => el.children.length === 0 && el.textContent?.trim())
					.map((el) => {
						const style = getComputedStyle(el);
						return {
							text: el.textContent!.trim(),
							nowrap: style.whiteSpace === 'nowrap',
							lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight))
						};
					})
			);
			expect(labels.map((l) => l.text)).toEqual(
				expect.arrayContaining(['ศูนย์อพยพ', 'กำลังเตรียมการ', 'ไม่ทราบสถานะ'])
			);
			for (const label of labels) {
				expect(label, label.text).toMatchObject({ nowrap: true, lines: 1 });
			}
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

		test('map view: the filters in use show as chips, and the filter button turns solid (#1460)', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const filterBtn = page.getByTestId('mobile-filter-btn');
			await expect(filterBtn).toBeVisible(READY);
			// no filter yet: outlined button, no counted chips
			await expect(filterBtn).not.toHaveAttribute('data-active', /.*/);

			await page.goto('/shelters?hide_full=true');
			await expect(filterBtn).toHaveAttribute('data-active', 'true', READY);
			const chips = page.getByRole('group', { name: 'ตัวกรองที่ใช้อยู่' });
			await expect(chips).toBeVisible(READY);
			await expect(chips.getByRole('button', { name: /ซ่อน/ }).first()).toBeVisible();

			// one scrolling row, and the map still fills the screen
			expect(await chips.evaluate((el) => getComputedStyle(el).flexWrap)).toBe('nowrap');
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

			await chips.getByRole('button', { name: 'ล้างทั้งหมด' }).click();
			await expect(filterBtn).not.toHaveAttribute('data-active', /.*/, READY);
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

	test.describe('1024px: both panels open', () => {
		test.use({ viewport: { width: 1024, height: 768 } });

		test('the legend folds into a toggle and opens across the map on demand (#1461)', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const toggle = page.getByTestId('map-legend-toggle');
			await expect(toggle).toBeVisible(READY);
			// folded: one small button, not a tall stack of rows over the map
			expect((await toggle.boundingBox())!.height).toBeLessThan(40);
			await expect(page.getByText('ไม่ทราบสถานะ')).toBeHidden();

			await toggle.click();
			const legend = page.getByTestId('map-legend');
			await expect(legend.getByText('ไม่ทราบสถานะ')).toBeVisible();
			// open: across the map, above the floating panels (nothing clips or covers a label)
			expect((await legend.boundingBox())!.width).toBeGreaterThan(500);
			for (const label of ['เปิดใช้งาน', 'กำลังเตรียมการ', 'เต็มความจุ', 'ปิดทำการ']) {
				await expect(legend.getByText(label)).toBeVisible();
			}
			// the close button takes a real click, so no panel covers the legend
			await page.getByTestId('map-legend-close').click();
			await expect(toggle).toBeVisible();
		});

		test('with one panel closed there is room for the whole legend', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			await expect(page.getByTestId('map-legend-toggle')).toBeVisible(READY);
			await page.getByTitle('ย่อรายการศูนย์').click();
			await expect(page.getByTestId('map-legend-toggle')).toHaveCount(0);
			await expect(page.getByTestId('map-legend').getByText('ไม่ทราบสถานะ')).toBeVisible();
		});
	});
});
