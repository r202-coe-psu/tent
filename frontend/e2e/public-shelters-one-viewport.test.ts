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
	await page.route('**/api/public/v1/shelters/summary**', (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				shelters_total: SHELTERS.length,
				shelters_open: SHELTERS.filter((s) => s.status === 'open').length,
				counts_by_site_kind: { evacuation_center: SHELTERS.length },
				as_of: '2026-11-18T03:00:00.000Z'
			})
		})
	);
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

	for (const viewport of [
		{ width: 390, height: 844 },
		{ width: 360, height: 640 }
	]) {
		test.describe(`mobile ${viewport.width}x${viewport.height}`, () => {
			test.use({ viewport, hasTouch: true, isMobile: true });

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

				await page.goto(
					'/shelters?hide_full=true&parking_car=on&parking_motorcycle=on&parking_boat=on'
				);
				await expect(filterBtn).toHaveAttribute('data-active', 'true', READY);
				const chips = page.getByRole('group', { name: 'ตัวกรองที่ใช้อยู่' });
				await expect(chips).toBeVisible(READY);
				await expect(chips.getByRole('button', { name: /ซ่อน/ }).first()).toBeVisible();

				// one scrolling row (it really overflows sideways), and the map still fills the screen
				const row = await chips.evaluate((el) => ({
					flexWrap: getComputedStyle(el).flexWrap,
					overflowX: getComputedStyle(el).overflowX,
					scrolls: el.scrollWidth > el.clientWidth
				}));
				expect(row).toMatchObject({ flexWrap: 'nowrap', overflowX: 'auto', scrolls: true });
				expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

				// "clear all" leads the row, so it is on screen without scrolling
				const clearAll = chips.getByRole('button', { name: 'ล้างทั้งหมด' });
				expect(
					await clearAll.evaluate((el) => el === el.parentElement!.querySelector('button'))
				).toBe(true);
				// touch targets: at least 44px high, and the focus ring is not clipped by the row
				for (const box of await chips
					.getByRole('button')
					.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height))) {
					expect(box).toBeGreaterThanOrEqual(44);
				}
				await chips.getByRole('button').first().focus();
				const ring = await chips.evaluate((el) => {
					const f = el.querySelector('button:focus-visible, button:focus') as HTMLElement | null;
					if (!f) return null;
					const r = f.getBoundingClientRect();
					const c = el.getBoundingClientRect();
					// room for ring-2 + ring-offset-2 (4px) on every side inside the scroller
					return { top: r.top - c.top, bottom: c.bottom - r.bottom };
				});
				expect(ring).not.toBeNull();
				expect(ring!.top).toBeGreaterThanOrEqual(4);
				expect(ring!.bottom).toBeGreaterThanOrEqual(4);

				await clearAll.click();
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
	}

	test.describe('1024px: both panels open', () => {
		test.use({ viewport: { width: 1024, height: 768 } });

		test('the legend folds into a toggle and opens across the map on demand (#1461)', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto('/shelters');
			const toggle = page.getByTestId('map-legend-toggle');
			await expect(toggle).toBeVisible(READY);
			// folded: one button (a 44px touch target), not a tall stack of rows over the map
			const box = (await toggle.boundingBox())!;
			expect(box.height).toBeGreaterThanOrEqual(44);
			expect(box.height).toBeLessThan(60);
			await expect(page.getByText('ไม่ทราบสถานะ')).toBeHidden();
			await expect(toggle).toHaveAttribute('aria-controls', 'shelter-map-legend');

			await toggle.click();
			const legend = page.getByTestId('map-legend');
			await expect(legend.getByText('ไม่ทราบสถานะ')).toBeVisible();
			// open: across the map, above the floating panels (nothing clips or covers a label)
			expect((await legend.boundingBox())!.width).toBeGreaterThan(500);
			for (const label of ['เปิดใช้งาน', 'กำลังเตรียมการ', 'เต็มความจุ', 'ปิดทำการ']) {
				await expect(legend.getByText(label)).toBeVisible();
			}
			await expectLegendOnTop(page);

			// keyboard: focus moves to the close button on open, and back to the toggle on close
			const close = page.getByTestId('map-legend-close');
			await expect(close).toBeFocused();
			expect((await close.boundingBox())!.width).toBeGreaterThanOrEqual(44);
			await page.keyboard.press('Enter');
			await expect(toggle).toBeVisible();
			await expect(toggle).toBeFocused();

			// Escape closes it too, and focus still lands on the toggle
			await toggle.click();
			await expect(close).toBeFocused();
			await page.keyboard.press('Escape');
			await expect(toggle).toBeVisible();
			await expect(toggle).toBeFocused();
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

	// #1461 asks for 1280x720 and 1440x900 too: from 1280 up the legend always fits, no toggle.
	for (const viewport of [
		{ width: 1280, height: 720 },
		{ width: 1440, height: 900 }
	]) {
		test.describe(`${viewport.width}x${viewport.height}: both panels open`, () => {
			test.use({ viewport });

			test('the whole legend shows without a toggle and nothing covers it', async ({ page }) => {
				await mockPublicApi(page);
				await page.goto('/shelters');
				const legend = page.getByTestId('map-legend');
				await expect(legend.getByText('ไม่ทราบสถานะ')).toBeVisible(READY);
				await expect(page.getByTestId('map-legend-toggle')).toHaveCount(0);
				await expect(page.getByTestId('map-legend-close')).toHaveCount(0);
				for (const label of ['เปิดใช้งาน', 'กำลังเตรียมการ', 'เต็มความจุ', 'ปิดทำการ']) {
					await expect(legend.getByText(label)).toBeVisible();
				}
				await expectLegendOnTop(page);
				expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
			});
		});
	}
});

/** Every legend label is what the browser would hit at its centre: no panel covers it. */
async function expectLegendOnTop(page: Page): Promise<void> {
	const covered = await page.getByTestId('map-legend').evaluate((root) =>
		[...root.querySelectorAll('span')]
			.filter((el) => el.children.length === 0 && el.textContent?.trim())
			.filter((el) => {
				const r = el.getBoundingClientRect();
				const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
				return !top || !root.contains(top);
			})
			.map((el) => el.textContent!.trim())
	);
	expect(covered).toEqual([]);
}
