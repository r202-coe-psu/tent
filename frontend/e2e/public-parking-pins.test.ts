/**
 * Public shelter pages with parking points (CR-253 FR-29 to FR-34).
 *
 * The public API is mocked in the browser, so this runs without FastAPI or Mongo: it proves the
 * SPA draws the pins, opens the popup, filters the list and shows the detail section. The
 * projection and API shape are covered by the worker and backend tests.
 *
 * Set `PARKING_SHOTS_DIR` to also save a screenshot of each step.
 */
import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.PARKING_SHOTS_DIR;
const USER_LOCATION = { latitude: 7.0086, longitude: 100.4747 };

test.use({ geolocation: USER_LOCATION, permissions: ['geolocation'] });

const shot = async (page: Page, name: string) => {
	if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
};

const shelter = (code: string, name: string, lat: number, extra: Record<string, unknown>) => ({
	code,
	name,
	site_kind: 'evacuation_center',
	status: 'open',
	capacity: 120,
	geo: { lat, lng: 100.4747 },
	province: 'สงขลา',
	district: 'หาดใหญ่',
	subdistrict: 'หาดใหญ่',
	accepts_pre_registration: true,
	updated_at: '2026-11-13T00:00:00Z',
	parking_points: [],
	parking_vehicle_types: [],
	...extra
});

const SH_CAR = shelter('SH_P1', 'ศูนย์จอดรถยนต์', 7.0086, {
	parking_vehicle_types: ['car', 'boat'],
	parking_points: [
		{
			id: 'a',
			name: 'ลานหน้าอาคาร',
			note: 'จอดได้เฉพาะรถยนต์',
			geo: { lat: 7.0092, lng: 100.4752 },
			vehicles: [
				{ type: 'car', max_capacity: 30 },
				{ type: 'boat', max_capacity: null }
			]
		},
		{
			id: 'b',
			name: 'ลานหลังอาคาร',
			note: null,
			geo: { lat: 7.0079, lng: 100.4741 },
			vehicles: [{ type: 'car', max_capacity: 20 }]
		}
	]
});
const SH_MOTO = shelter('SH_P2', 'ศูนย์มอเตอร์ไซค์', 7.0136, {
	parking_vehicle_types: ['motorcycle'],
	parking_points: [
		{
			id: 'c',
			name: 'จุดจอดมอเตอร์ไซค์',
			note: null,
			geo: { lat: 7.0141, lng: 100.4767 },
			vehicles: [{ type: 'motorcycle', max_capacity: 100 }]
		}
	]
});
const SH_NONE = shelter('SH_P3', 'ศูนย์ไม่มีที่จอดรถ', 7.0046, {});

async function mockPublicApi(page: Page) {
	await page.route(/\/api\/public\/v1\/shelters(\?.*)?$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				shelters: [SH_CAR, SH_MOTO, SH_NONE],
				count: 3,
				as_of: '2026-11-13T00:00:00Z'
			})
		})
	);
	await page.route(/\/api\/public\/v1\/shelters\/SH_P1$/, (route) =>
		route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ shelter: SH_CAR })
		})
	);
}

/** The parking boxes sit under the collapsed advanced filters. */
const parkingBox = async (page: Page, name: RegExp) => {
	await page
		.getByRole('button', { name: /ตัวกรองขั้นสูง/ })
		.first()
		.click();
	return page.getByRole('checkbox', { name }).first();
};

const pins = (page: Page, code?: string) =>
	page.locator(`[data-testid^="parking-marker-${code ?? ''}"]`);

test.describe('Public shelters — parking points (CR-253)', () => {
	test('the map draws a pin for every parking point of the listed shelters and opens a popup', async ({
		page
	}) => {
		await mockPublicApi(page);
		await page.goto('/shelters');

		await expect(pins(page)).toHaveCount(3);
		await expect(pins(page, 'SH_P1:')).toHaveCount(2);
		await expect(pins(page, 'SH_P2:')).toHaveCount(1);
		await expect(page.getByTestId('parking-legend')).toBeVisible();
		await shot(page, 'public-1-map-parking-pins');

		await pins(page, 'SH_P1:a').click();
		const popup = page.getByTestId('parking-popup-SH_P1:a');
		await expect(popup).toContainText('ลานหน้าอาคาร');
		await expect(popup).toContainText('จอดได้เฉพาะรถยนต์');
		await expect(popup).toContainText('รถยนต์ / รถกระบะ · รองรับสูงสุด 30 คัน');
		await expect(popup).toContainText('เรือ · ไม่ระบุจำนวน');
		await shot(page, 'public-2-map-parking-popup');
	});

	test('ticking the car filter keeps only shelters that take cars, pins included', async ({
		page
	}) => {
		await mockPublicApi(page);
		await page.goto('/shelters');
		await expect(pins(page)).toHaveCount(3);

		await (await parkingBox(page, /รถยนต์/)).click();
		await expect(page).toHaveURL(/parking_car=on/);
		await expect(pins(page, 'SH_P1:')).toHaveCount(2);
		await expect(pins(page, 'SH_P2:')).toHaveCount(0);
		await shot(page, 'public-3-filter-car');
	});

	test('two ticked types need a shelter that takes both, and a refresh keeps the boxes ticked', async ({
		page
	}) => {
		await mockPublicApi(page);
		await page.goto(
			'/shelters?parking_car=on&parking_motorcycle=on&user_lat=7.0086&user_lng=100.4747&distance=5'
		);
		// No shelter takes both a car and a motorcycle: no list entries and no pins.
		await expect(pins(page)).toHaveCount(0);
		await shot(page, 'public-4-filter-no-match');

		await page.goto('/shelters?parking_boat=on&user_lat=7.0086&user_lng=100.4747&distance=5');
		await expect(pins(page, 'SH_P1:')).toHaveCount(2);
		await expect(await parkingBox(page, /เรือ/)).toBeChecked();
		await page.reload();
		await expect(await parkingBox(page, /เรือ/)).toBeChecked();
	});

	test('the shelter page lists its parking points, and nothing for a shelter without any', async ({
		page
	}) => {
		await mockPublicApi(page);
		await page.goto('/shelters/SH_P1');
		const section = page.getByTestId('shelter-parking');
		await expect(section).toContainText('ลานหน้าอาคาร');
		await expect(section).toContainText('รองรับสูงสุด 30 คัน');
		await expect(section).toContainText('ลานหลังอาคาร');
		await section.scrollIntoViewIfNeeded();
		await shot(page, 'public-5-detail-parking');

		await page.route(/\/api\/public\/v1\/shelters\/SH_P3$/, (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelter: SH_NONE })
			})
		);
		await page.goto('/shelters/SH_P3');
		await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
		await expect(page.getByTestId('shelter-parking')).toHaveCount(0);
	});
});
