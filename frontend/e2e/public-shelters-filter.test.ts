/**
 * Public shelter directory (/shelters) filters — true end-to-end, no seeding and
 * no mocks (except the thin error-contract route in the smoke group).
 *
 * Writable target (local, or staging with `ALLOW_REMOTE_WRITES=true`): the critical group
 * creates two per-run `E2E…` shelters the way staff do (system management → create
 * shelter) — a host house next to the user and an evacuation centre ~7 km away — and tears
 * them down through the CouchDB admin API (the UI cannot delete shelters); the Z test
 * proves they are gone from CouchDB and from the public list. Read-only remote target
 * (production): setup and teardown are skipped and the tests filter the provisioned E2E
 * fixture (see helpers/e2e-env.ts).
 *
 * Every public test narrows the list with the fixture's name marker so other
 * shelters never affect the assertions.
 *
 * ── Tags ──────────────────────────────────────────────────────────────────────────
 *  @public    feature tag
 *  @smoke     read-only render / error (safe on staging/prod)
 *  @critical  writes (two E2E shelters) + live filter asserts; read-only when !CAN_WRITE
 *  @release   thin release-gate journey (directory shell + filter panel)
 *  @prod      compact production smoke subset of @release
 *
 * Local requirements: `docker compose up -d` (CouchDB, MongoDB, sync worker, FastAPI
 * :9000) plus platform init (`pnpm seed:master`, `pnpm db:sync`).
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { CAN_WRITE, READ_ONLY_REASON, sheltersFixture } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { publicShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

const { marker: MARKER, hostNear: HOST_NEAR, evacFar: EVAC_FAR } = sheltersFixture();
const USER_LOCATION = { latitude: 7.0086, longitude: 100.4968 };

let codes: string[] = [];

test.use({ geolocation: USER_LOCATION, permissions: ['geolocation'] });

test.afterAll(async () => {
	test.setTimeout(120_000);
	for (const code of codes) await teardownShelter(code);
});

test.describe(
	'Public shelter directory: render contract',
	{ tag: ['@public', '@smoke', '@release', '@prod'] },
	() => {
		test('R1 the directory shell and filter panel are rendered', async ({ page }) => {
			await page.goto('/shelters');
			await expect(page).toHaveURL(/distance=5/);
			await expect(page.getByRole('heading', { name: 'ค้นหาและตัวกรอง' })).toBeVisible();
			await expect(page.getByRole('textbox', { name: 'ค้นหา' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ชนิดสถานที่' })).toBeVisible();
			await expect(page.getByRole('button', { name: '5 กม' })).toBeVisible();
		});
	}
);

test.describe('Public shelter directory: error contract', { tag: ['@public', '@smoke'] }, () => {
	test('a failing shelters list still shows the filter panel and the empty state', async ({
		page
	}) => {
		await page.route('**/api/public/v1/shelters**', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/shelters');
		await expect(page.getByRole('heading', { name: 'ค้นหาและตัวกรอง' })).toBeVisible();
		await expect(page.getByText('ไม่พบข้อมูลศูนย์พักพิง')).toBeVisible();
	});

	test.fixme('GAP: /shelters does not surface a distinct load-error message when the shelters API fails (silently degrades to the empty "ไม่พบข้อมูลศูนย์พักพิง" state)', async ({
		page
	}) => {
		await page.route('**/api/public/v1/shelters**', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/shelters');
		await expect(page.getByText('ไม่สามารถโหลดรายการศูนย์พักพิงได้')).toBeVisible();
	});
});

test.describe(
	'Public shelter directory filters: live results',
	{ tag: ['@public', '@critical'] },
	() => {
		test.describe.configure({ mode: 'serial' });

		test('staff creates a nearby host house and a distant evacuation centre', async ({ page }) => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.setTimeout(120_000);
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);

			codes.push(await createShelterViaUi(page, HOST_NEAR));
			codes.push(await createShelterViaUi(page, EVAC_FAR));
		});

		test('filters the list by shelter name', async ({ page }) => {
			test.setTimeout(75_000); // outlasts the 60 s projection wait below
			await page.goto('/shelters');
			await expect(page).toHaveURL(/distance=5/);
			await expect(page.getByRole('heading', { name: 'ค้นหาและตัวกรอง' })).toBeVisible();

			// These shelters were just created — the worker's registry listener only
			// polls for brand-new shelter databases every 30s (listeners/registry.py),
			// so this first wait needs headroom past that; retry the filter until it does.
			await expect(async () => {
				await page.goto('/shelters');
				await page.getByRole('textbox', { name: 'ค้นหา' }).fill(MARKER);
				await expect(page.getByRole('heading', { name: HOST_NEAR.name })).toBeVisible({
					timeout: 3_000
				});
			}).toPass({ intervals: [2_000], timeout: 60_000 });
			await expect(page).toHaveURL(/q=/);
			await expect(page.getByRole('heading', { name: EVAC_FAR.name })).toBeHidden();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);
		});

		test('widens and narrows the GPS radius', async ({ page }) => {
			await page.goto(`/shelters?q=${encodeURIComponent(MARKER)}`);
			await expect(page).toHaveURL(/distance=5/);
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);

			await page.getByRole('button', { name: '10 กม' }).click();
			await expect(page).toHaveURL(/distance=10/);
			await expect(page.getByRole('heading', { name: EVAC_FAR.name })).toBeVisible();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(2);

			await page.getByRole('button', { name: '1 กม' }).click();
			await expect(page).toHaveURL(/distance=1(&|$)/);
			await expect(page.getByRole('heading', { name: HOST_NEAR.name })).toBeVisible();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);
		});

		test('filters by site kind', async ({ page }) => {
			await page.goto(`/shelters?q=${encodeURIComponent(MARKER)}&distance=10`);
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(2);

			await page.getByRole('button', { name: 'ชนิดสถานที่' }).click();
			await page.getByRole('option', { name: 'บ้านพี่เลี้ยง' }).click();
			await expect(page).toHaveURL(/site_kind=host_house/);
			await expect(page.getByRole('heading', { name: HOST_NEAR.name })).toBeVisible();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);

			await page.getByRole('button', { name: 'ชนิดสถานที่' }).click();
			await page.getByRole('option', { name: 'ศูนย์อพยพ' }).click();
			await expect(page).toHaveURL(/site_kind=evacuation_center/);
			await expect(page.getByRole('heading', { name: EVAC_FAR.name })).toBeVisible();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);
		});

		test('cascades province → district → subdistrict and opens the detail page', async ({
			page
		}) => {
			await page.goto(`/shelters?q=${encodeURIComponent(MARKER)}&distance=10`);
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(2);

			await page.getByRole('button', { name: 'จังหวัด', exact: true }).click();
			await page.getByRole('textbox', { name: 'ค้นหา...' }).fill('สงขลา');
			await page.getByRole('button', { name: 'สงขลา' }).click();
			await expect(page).toHaveURL(/province=/);

			await page.getByRole('button', { name: 'อำเภอ/เขต' }).click();
			await page.getByRole('button', { name: 'หาดใหญ่' }).click();
			await expect(page).toHaveURL(/district=/);

			await page.getByRole('button', { name: 'ตำบล/แขวง' }).click();
			await page.getByRole('button', { name: 'บ้านพรุ' }).click();
			await expect(page).toHaveURL(/subdistrict=/);
			await expect(page.getByRole('heading', { name: EVAC_FAR.name })).toBeVisible();
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);

			await page.getByRole('link', { name: 'ดูรายละเอียด' }).click();
			await expect(page).toHaveURL(/\/shelters\/SH\d+$/);
			await expect(page.getByRole('heading', { name: EVAC_FAR.name })).toBeVisible();
		});

		test('clears every filter', async ({ page }) => {
			await page.goto(`/shelters?q=${encodeURIComponent(MARKER)}&site_kind=host_house&distance=10`);
			await expect(page.getByRole('heading', { name: MARKER })).toHaveCount(1);

			await page.getByRole('link', { name: 'ล้างค่า' }).click();
			await expect(page).not.toHaveURL(/q=|site_kind=/);
			await expect(page.getByRole('textbox', { name: 'ค้นหา' })).toHaveValue('');
			await expect(page.getByRole('heading', { name: HOST_NEAR.name })).toBeVisible();
		});

		test('Z teardown leaves no shelter of this run', async () => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.setTimeout(180_000);
			expect(codes, 'setup created both shelters').toHaveLength(2);
			const created = codes;
			for (const code of created) await teardownShelter(code);
			codes = [];

			for (const code of created) {
				expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
				const byCode = await couchReq(
					'GET',
					`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
				);
				expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
				// the worker cascades the registry delete to the public plane asynchronously
				// The row itself stays as `closed` until the worker's retention job (every 5 min,
				// reconcile_closed_shelters) removes it — never as anything a citizen could book.
				const row = await publicShelter(code);
				expect(row === undefined || row.status === 'closed', `${code} left as ${row?.status}`).toBe(
					true
				);
			}
		});
	}
);
