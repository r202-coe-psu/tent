/**
 * E2E (mock): the public shelter search shows which filters are on (#1419).
 *
 * Every API boundary is mocked — no CouchDB / Mongo / FastAPI needed. The visitor sees one chip
 * per active filter above the list, can remove each one or clear them all, sees how many filters
 * are on from the filter buttons (the default 5 km radius is not counted), and an empty list says
 * why it is empty and offers a way out. The page still fits one viewport with the chips on.
 */
import { test, expect, type Page } from '@playwright/test';

const shelter = (n: number) => ({
	code: `SH${String(n).padStart(3, '0')}`,
	name: `ศูนย์พักพิง E2E ลำดับ ${n}`,
	status: 'open',
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

type MockOptions = {
	/** Hold every list response this long, to see the page while a filter loads. */
	delayMs?: number;
};

/**
 * Lists every shelter, except: a radius drawn around a point far from Hat Yai (lat > 10, like
 * Bangkok) finds nothing, and `hide_full` finds nothing (to reach the "filtered" empty state).
 */
async function mockPublicApi(page: Page, options: MockOptions = {}): Promise<void> {
	await page.route('**/api/public/v1/shelters**', async (route) => {
		const url = new URL(route.request().url());
		if (url.pathname === '/api/public/v1/shelters/summary') {
			return route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					shelters_total: 14,
					shelters_open: 14,
					counts_by_site_kind: {},
					as_of: '2026-11-18T03:00:00.000Z'
				})
			});
		}
		if (url.pathname !== '/api/public/v1/shelters') return route.fallback();
		const farAway = Number(url.searchParams.get('lat') ?? 0) > 10;
		const shelters = farAway || url.searchParams.has('hide_full') ? [] : SHELTERS;
		if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
		return route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				shelters,
				count: shelters.length,
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

const HAT_YAI = 'user_lat=7.0086&user_lng=100.4968';
const BANGKOK = 'user_lat=13.7442&user_lng=100.4608';
/** The first paint of this client-rendered page can be slow on a cold server. */
const READY = { timeout: 20_000 };

const pageOverflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);

/** The chip row that is on screen (desktop right panel or the mobile list). */
const chipRow = (page: Page) =>
	page.locator('[role="group"][aria-label="ตัวกรองที่ใช้อยู่"]:visible');
const chip = (page: Page, label: string) =>
	chipRow(page).getByRole('button', { name: `เอา ${label} ออก` });

const params = (page: Page) => new URL(page.url()).searchParams;

test.describe('Public shelters: active filters', { tag: ['@public', '@regression'] }, () => {
	test.describe('desktop', () => {
		test.use({ viewport: { width: 1440, height: 900 } });

		test('the list is headed "ศูนย์พักพิงที่พบ" and shows the radius as a chip', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5`);
			await expect(page.getByRole('heading', { name: 'ศูนย์พักพิงที่พบ' })).toBeVisible(READY);
			await expect(chip(page, 'ระยะ 5 กม.')).toBeVisible();
			// only the default radius: nothing to "clear all"
			await expect(chipRow(page).getByRole('button', { name: 'ล้างทั้งหมด' })).toHaveCount(0);
		});

		test('a chip removes its filter; a province takes its district and subdistrict', async ({
			page
		}) => {
			await mockPublicApi(page);
			const area = 'province=สงขลา&district=หาดใหญ่&subdistrict=คอหงส์';
			await page.goto(`/shelters?${HAT_YAI}&distance=5&q=ศูนย์&${area}`);
			await expect(chip(page, 'ค้นหา: "ศูนย์"')).toBeVisible(READY);
			await expect(chip(page, 'ตำบล: คอหงส์')).toBeVisible();

			await chip(page, 'ค้นหา: "ศูนย์"').click();
			await expect.poll(() => params(page).has('q')).toBe(false);
			await expect(chip(page, 'ค้นหา: "ศูนย์"')).toHaveCount(0);

			await chip(page, 'จังหวัด: สงขลา').click();
			await expect.poll(() => params(page).has('province')).toBe(false);
			expect(params(page).has('district')).toBe(false);
			expect(params(page).has('subdistrict')).toBe(false);
			expect(params(page).get('user_lat')).toBe('7.0086');
		});

		test('removing the radius chip clears the radius (distance=)', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5`);
			await chip(page, 'ระยะ 5 กม.').click();
			await expect.poll(() => params(page).get('distance')).toBe('');
			await expect(chip(page, 'ระยะ 5 กม.')).toHaveCount(0);
		});

		test('"clear all" keeps the position and the default radius', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=10&q=ศูนย์&status=open&parking_car=on`);
			await chipRow(page).getByRole('button', { name: 'ล้างทั้งหมด' }).click(READY);
			await expect.poll(() => params(page).has('q')).toBe(false);
			expect(params(page).has('status')).toBe(false);
			expect(params(page).has('parking_car')).toBe(false);
			expect(params(page).get('user_lat')).toBe('7.0086');
			expect(params(page).get('distance')).toBe('5');
			await expect(chip(page, 'ระยะ 5 กม.')).toBeVisible();
		});

		test('the collapsed filter button counts the filters, but not the default radius', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5`);
			await page.getByRole('button', { name: 'Close filter panel' }).first().click(READY);
			const collapsed = page.getByRole('button', { name: /ค้นหาและตัวกรอง/ });
			await expect(collapsed).toBeVisible();
			await expect(collapsed).not.toContainText(/\d/);

			await page.goto(`/shelters?${HAT_YAI}&distance=10&parking_boat=on`);
			await page.getByRole('button', { name: 'Close filter panel' }).first().click(READY);
			await expect(page.getByRole('button', { name: /ค้นหาและตัวกรอง/ })).toContainText('2');
		});

		test('the list dims while a filter loads, then announces the result', async ({ page }) => {
			await mockPublicApi(page, { delayMs: 1500 });
			await page.goto(`/shelters?${HAT_YAI}&distance=5&parking_car=on`);
			const list = page
				.locator('[aria-busy]:visible')
				.filter({ has: page.locator('[data-shelter-code="SH001"]') });
			await expect(list).toHaveAttribute('aria-busy', 'false', READY);
			const live = page.getByTestId('results-announcer');
			await expect(live).toHaveText('');

			await chip(page, 'ที่จอดรถยนต์').click();
			await expect(list).toHaveAttribute('aria-busy', 'true');
			await expect(list).toHaveAttribute('aria-busy', 'false', READY);
			await expect(live).toHaveText('พบ 14 แห่ง');
		});

		test('an empty radius says so; widen it or forget the location', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${BANGKOK}&distance=5`);
			const panel = page.locator('.lg\\:flex').filter({ hasText: 'ศูนย์พักพิงที่พบ' });
			await expect(panel.getByText('ไม่มีศูนย์ในรัศมี 5 กม. จากตำแหน่งนี้')).toBeVisible(READY);

			await panel.getByRole('button', { name: 'ขยายรัศมี' }).click();
			await expect.poll(() => params(page).get('distance')).toBe('10');
			await expect(panel.getByText('ไม่มีศูนย์ในรัศมี 10 กม. จากตำแหน่งนี้')).toBeVisible();

			await panel.getByRole('button', { name: 'ล้างตำแหน่ง' }).click();
			await expect.poll(() => params(page).has('user_lat')).toBe(false);
			expect(params(page).has('distance')).toBe(false);
			await expect(page.locator('[data-shelter-code="SH001"]')).toBeVisible();
			// the position stays gone (nothing puts it back by itself)
			await page.waitForTimeout(1000);
			expect(params(page).has('user_lat')).toBe(false);
		});

		test('list panel collapsed + nothing found: the way out is on the map', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${BANGKOK}&distance=5`);
			await page.getByRole('button', { name: 'ย่อรายการศูนย์' }).click(READY);
			const overlay = page.getByTestId('map-filter-overlay');
			await expect(overlay.getByText('ไม่มีศูนย์ในรัศมี 5 กม. จากตำแหน่งนี้')).toBeVisible();
			await expect(overlay.getByRole('button', { name: 'เอา ระยะ 5 กม. ออก' })).toBeVisible();
			// it sits on the map, below the pin control, and the page still does not scroll
			const pin = await page.getByRole('button', { name: 'วางหมุดค้นหา' }).boundingBox();
			const box = await overlay.boundingBox();
			expect(box!.y).toBeGreaterThan(pin!.y + pin!.height);
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

			await overlay.getByRole('button', { name: 'ล้างตำแหน่ง' }).click();
			await expect.poll(() => params(page).has('user_lat')).toBe(false);
			await expect(page.getByTestId('map-filter-overlay')).toHaveCount(0);
			await expect(page.getByRole('button', { name: /ศูนย์พักพิงที่พบ/ })).toContainText('14');
		});

		test('list panel collapsed + a search with no match: clearing on the map brings results back', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5&hide_full=true`);
			await page.getByRole('button', { name: 'ย่อรายการศูนย์' }).click(READY);
			const overlay = page.getByTestId('map-filter-overlay');
			await expect(overlay.getByText('ไม่พบศูนย์ที่ตรงกับตัวกรอง')).toBeVisible();
			await overlay.getByRole('button', { name: 'ล้างทั้งหมด' }).click();
			await expect.poll(() => params(page).has('hide_full')).toBe(false);
			await expect(page.getByRole('button', { name: /ศูนย์พักพิงที่พบ/ })).toContainText('14');
			// only the default radius left: the chip stays on the map, the empty message goes
			await expect(overlay.getByText('ไม่พบศูนย์ที่ตรงกับตัวกรอง')).toHaveCount(0);
		});

		test('list panel open: the chips are not repeated on the map', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${BANGKOK}&distance=5`);
			await expect(chip(page, 'ระยะ 5 กม.')).toBeVisible(READY);
			await expect(page.getByTestId('map-filter-overlay')).toHaveCount(0);
		});

		test('an empty list under other filters offers to clear them', async ({ page }) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5&hide_full=true`);
			const panel = page.locator('.lg\\:flex').filter({ hasText: 'ศูนย์พักพิงที่พบ' });
			await expect(panel.getByText('ไม่พบศูนย์ที่ตรงกับตัวกรอง')).toBeVisible(READY);
			await panel.getByRole('button', { name: 'ล้างตัวกรอง' }).click();
			await expect.poll(() => params(page).has('hide_full')).toBe(false);
			expect(params(page).get('distance')).toBe('5');
			await expect(page.locator('[data-shelter-code="SH001"]')).toBeVisible();
		});
	});

	for (const viewport of [
		{ width: 1280, height: 720 },
		{ width: 1024, height: 768 }
	]) {
		test(`many chips wrap inside the panel and the page still does not scroll (${viewport.width}x${viewport.height})`, async ({
			page
		}) => {
			await page.setViewportSize(viewport);
			await mockPublicApi(page);
			await page.goto(
				`/shelters?${HAT_YAI}&distance=10&q=โรงเรียนบ้านคลองแห&status=open&province=สงขลา&district=หาดใหญ่&subdistrict=คอหงส์&parking_car=on&parking_motorcycle=on&parking_boat=on&hide_evacuation=on`
			);
			const row = chipRow(page);
			await expect(row).toBeVisible(READY);
			const m = await row.evaluate((el) => {
				const box = el.getBoundingClientRect();
				const panel = el.closest('.rounded-2xl')!.getBoundingClientRect();
				return {
					overflows: el.scrollWidth > el.clientWidth + 1,
					insidePanel: box.left >= panel.left - 1 && box.right <= panel.right + 1
				};
			});
			expect(m).toEqual({ overflows: false, insidePanel: true });
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);
		});
	}

	test.describe('mobile', () => {
		test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

		test('the filter button counts, the list view shows the chips, no page scroll', async ({
			page
		}) => {
			await mockPublicApi(page);
			await page.goto(`/shelters?${HAT_YAI}&distance=5&hide_full=true&q=ศูนย์`);
			const filterButton = page.getByRole('button', { name: /^ตัวกรอง/ });
			await expect(filterButton).toContainText('2', READY);

			await page
				.getByRole('button', { name: /รายการ/ })
				.first()
				.click();
			await expect(chip(page, 'ซ่อนที่เต็ม')).toBeVisible();
			await expect(chip(page, 'ระยะ 5 กม.')).toBeVisible();
			// the desktop panel is in the DOM but hidden; only the mobile list shows the message
			await expect(
				page.getByText('ไม่พบศูนย์ที่ตรงกับตัวกรอง').locator('visible=true')
			).toHaveCount(1);
			expect(await pageOverflow(page)).toBeLessThanOrEqual(0);

			await chip(page, 'ซ่อนที่เต็ม').click();
			await expect.poll(() => params(page).has('hide_full')).toBe(false);
			await expect(filterButton).toContainText('1');
		});
	});
});
