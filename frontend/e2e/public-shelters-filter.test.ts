/**
 * Public shelter directory (/shelters) filters — true end-to-end, no seeding and
 * no mocks.
 *
 * Local target: the first test creates two shelters the way staff do (system
 * management → create shelter) — a host house next to the user and an evacuation
 * centre ~7 km away — and afterAll tears them down through the CouchDB admin API
 * (the UI cannot delete shelters). Remote target (`E2E_BASE_URL`, staging/production):
 * read-only — setup and teardown are skipped and the tests filter the provisioned E2E
 * fixture (see helpers/e2e-env.ts).
 *
 * Every public test narrows the list with the fixture's name marker so other
 * shelters never affect the assertions.
 *
 * Local requirements: `docker compose up -d` (CouchDB, MongoDB, sync worker, FastAPI
 * :9000) plus platform init (`pnpm seed:master`, `pnpm db:sync`).
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession } from './helpers/couch';
import { IS_REMOTE, READ_ONLY_REASON, sheltersFixture } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

test.describe.configure({ mode: 'serial' });

const { marker: MARKER, hostNear: HOST_NEAR, evacFar: EVAC_FAR } = sheltersFixture();
const USER_LOCATION = { latitude: 7.0086, longitude: 100.4968 };

const codes: string[] = [];

test.use({ geolocation: USER_LOCATION, permissions: ['geolocation'] });

test.afterAll(async () => {
	test.setTimeout(120_000);
	for (const code of codes) await teardownShelter(code);
});

test.describe('Public shelter directory filters', () => {
	test('staff creates a nearby host house and a distant evacuation centre', async ({ page }) => {
		test.skip(IS_REMOTE, READ_ONLY_REASON);
		test.setTimeout(120_000);
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		codes.push(await createShelterViaUi(page, HOST_NEAR));
		codes.push(await createShelterViaUi(page, EVAC_FAR));
	});

	test('filters the list by shelter name', async ({ page }) => {
		test.setTimeout(90_000); // outlasts the 60 s projection wait below
		await page.goto('/shelters');
		await expect(page).toHaveURL(/distance=5/);
		await expect(page.getByRole('heading', { name: 'ค้นหาและตัวกรอง' })).toBeVisible();

		// The worker projects new shelters asynchronously — retry the filter.
		await expect(async () => {
			await page.goto('/shelters');
			await page.getByRole('textbox', { name: 'ค้นหา' }).fill(MARKER);
			await expect(page.getByRole('heading', { name: HOST_NEAR.name })).toBeVisible({
				timeout: 3_000
			});
		}).toPass({ intervals: [3_000], timeout: 60_000 });
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

	test('cascades province → district → subdistrict and opens the detail page', async ({ page }) => {
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
});
