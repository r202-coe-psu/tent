/**
 * Public family search (/search) — true end-to-end, no seeding and no mocks
 * (except the thin server-error route in the smoke group).
 *
 * Local target: the critical group does what staff do — create a shelter in system
 * management and register households at Station 1 — and afterAll tears the shelter
 * down through the CouchDB admin API (the UI cannot delete shelters or evacuees).
 * Remote target (`E2E_BASE_URL`, staging/production): read-only — setup and teardown
 * are skipped and the tests search the provisioned E2E fixture (see helpers/e2e-env.ts).
 *
 * The public tests always go through the real path
 * (CouchDB → sync worker → Mongo → FastAPI → BFF).
 *
 * ── Tags ──────────────────────────────────────────────────────────────────────────
 *  @public    feature tag
 *  @smoke     read-only form / validation / server-error (safe on staging/prod)
 *  @critical  local writes (shelter + households) + live search asserts; skip when IS_REMOTE
 *  @release   thin release-gate journey (search form + min-length error)
 *  @prod      compact production smoke subset of @release
 *
 * Local requirements: `docker compose up -d` (CouchDB, MongoDB, sync worker, FastAPI
 * :9000) plus platform init (`pnpm seed:master`, `pnpm db:sync`).
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession } from './helpers/couch';
import {
	FIXTURE_LAST_NAME as LAST_NAME,
	FIXTURE_LAST_NAME_MASKED as LAST_NAME_MASKED,
	IS_REMOTE,
	READ_ONLY_REASON,
	searchFixture
} from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { teardownShelter } from './helpers/public-cleanup';
import {
	createShelterViaUi,
	registerHouseholdViaUi,
	selectActiveShelter
} from './helpers/staff-ui';

const FIXTURE = searchFixture();
const { prefix: PREFIX, phone: PHONE, head: HEAD, solo: SOLO, total: TOTAL } = FIXTURE;
const { member1: MEMBER_1, member2: MEMBER_2, shelterName: SHELTER_NAME } = FIXTURE;
const { nationalId: NATIONAL_ID, passport: PASSPORT } = FIXTURE;
/** The same ID written the way it is printed on the card: 0-1234-56789-01-2. */
const NATIONAL_ID_DASHED = [
	NATIONAL_ID.slice(0, 1),
	NATIONAL_ID.slice(1, 5),
	NATIONAL_ID.slice(5, 10),
	NATIONAL_ID.slice(10, 12),
	NATIONAL_ID.slice(12)
].join('-');

const SEARCH_BOX = 'พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน';

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) await teardownShelter(shelterCode);
});

test.describe(
	'Public family search: render and error contract',
	{ tag: ['@public', '@smoke', '@release', '@prod'] },
	() => {
		test('R1 the search form is fully rendered', async ({ page }) => {
			await page.goto('/search');
			await expect(page).toHaveTitle(/ระบบค้นหาผู้พักพิง/);
			await expect(page.getByRole('heading', { name: 'กรอกข้อมูลเพื่อค้นหา' })).toBeVisible();
			await expect(page.getByRole('textbox', { name: SEARCH_BOX })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ค้นหา' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'เริ่มการค้นหา' })).toBeVisible();
		});

		test('E01 rejects a query shorter than 3 characters', async ({ page }) => {
			await page.goto('/search');
			await page.getByRole('textbox', { name: SEARCH_BOX }).fill('ทด');
			await page.getByRole('button', { name: 'ค้นหา' }).click();
			await expect(page.getByText('กรุณากรอกข้อมูลอย่างน้อย 3')).toBeVisible();
			await expect(page.getByRole('heading', { name: 'เริ่มการค้นหา' })).toBeVisible();
		});
	}
);

test.describe('Public family search: server errors', { tag: ['@public', '@smoke'] }, () => {
	test('S1 a failing occupants search shows a readable error and keeps the query', async ({
		page
	}) => {
		await page.route('**/api/public/v1/occupants', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill('นายทดสอบระบบ');
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText('เกิดข้อผิดพลาดในการค้นหา')).toBeVisible();
		await expect(page.getByRole('textbox', { name: SEARCH_BOX })).toHaveValue('นายทดสอบระบบ');
		await expect(page.getByRole('heading', { name: 'ไม่พบรายชื่อ' })).toHaveCount(0);
	});
});

test.describe('Public family search: live results', { tag: ['@public', '@critical'] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('staff creates a shelter and registers households', async ({ page }) => {
		test.skip(IS_REMOTE, READ_ONLY_REASON);
		test.setTimeout(180_000);
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		shelterCode = await createShelterViaUi(page, {
			name: SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.0,
			lng: 100.47,
			subdistrict: 'คอหงส์',
			capacity: 50
		});
		await selectActiveShelter(page, shelterCode);
		for (const household of FIXTURE.households) await registerHouseholdViaUi(page, household);
	});

	test('finds everyone by name prefix and paginates 5 per page', async ({ page }) => {
		test.setTimeout(45_000); // outlasts the 35 s projection wait below
		// The shelter was just created — the worker's registry listener only polls for
		// brand-new shelter databases every 30s (listeners/registry.py), so this first
		// wait needs headroom past that; retry the search until it does.
		await expect(async () => {
			await page.goto(`/search?q=${encodeURIComponent(PREFIX)}`);
			await expect(page.getByText(`พบข้อมูลทั้งหมด ${TOTAL} รายการ`)).toBeVisible({
				timeout: 3_000
			});
		}).toPass({ intervals: [2_000], timeout: 35_000 });

		await expect(page.getByRole('heading', { name: PREFIX })).toHaveCount(5);
		await expect(page.getByText('หน้า 1 จาก 2')).toBeVisible();
		await expect(page.getByRole('button', { name: 'ก่อนหน้า' })).toBeDisabled();

		await page.getByRole('button', { name: 'ถัดไป' }).click();
		await expect(page.getByText('หน้า 2 จาก 2')).toBeVisible();
		await expect(page.getByRole('heading', { name: PREFIX })).toHaveCount(1);
		await expect(page.getByRole('button', { name: 'ถัดไป' })).toBeDisabled();

		await page.getByRole('button', { name: 'ก่อนหน้า' }).click();
		await expect(page.getByText('หน้า 1 จาก 2')).toBeVisible();
	});

	test('rejects a short query then recovers with a valid search', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill('ทด');
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText('กรุณากรอกข้อมูลอย่างน้อย 3')).toBeVisible();

		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(PREFIX);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText(`พบข้อมูลทั้งหมด ${TOTAL} รายการ`)).toBeVisible();
		await expect(page.getByText('กรุณากรอกข้อมูลอย่างน้อย 3')).toBeHidden();
	});

	test('shows the household members of a result and toggles them', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(HEAD);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText('พบข้อมูลทั้งหมด 1 รายการ')).toBeVisible();
		await expect(page.getByRole('heading', { name: `${HEAD} ${LAST_NAME_MASKED}` })).toBeVisible();
		await expect(page.getByText('มากับครอบครัว')).toBeVisible();
		await expect(page.getByText(SHELTER_NAME, { exact: true })).toBeVisible();
		await expect(page.getByText(`${MEMBER_1} ${LAST_NAME_MASKED}`)).toBeVisible();
		await expect(page.getByText(`${MEMBER_2} ${LAST_NAME_MASKED}`)).toBeVisible();

		await page.getByText('ข้อมูลสมาชิกในครอบครัว (2 คน)').click();
		await expect(page.getByText(`${MEMBER_1} ${LAST_NAME_MASKED}`)).toBeHidden();

		await page.getByText('ข้อมูลสมาชิกในครอบครัว (2 คน)').click();
		await expect(page.getByText(`${MEMBER_1} ${LAST_NAME_MASKED}`)).toBeVisible();
	});

	test('finds a person by exact phone number without revealing PII', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(PHONE);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText('พบข้อมูลทั้งหมด 1 รายการ')).toBeVisible();
		await expect(page.getByRole('heading', { name: `${HEAD} ${LAST_NAME_MASKED}` })).toBeVisible();
		await expect(page.getByText(PHONE)).toHaveCount(0);
		await expect(page.getByText(LAST_NAME)).toHaveCount(0);
	});

	test('finds a person by national ID, with or without dashes, without revealing it', async ({
		page
	}) => {
		for (const query of [NATIONAL_ID, NATIONAL_ID_DASHED]) {
			await page.goto('/search');
			await page.getByRole('textbox', { name: SEARCH_BOX }).fill(query);
			await page.getByRole('button', { name: 'ค้นหา' }).click();
			await expect(page.getByText('พบข้อมูลทั้งหมด 1 รายการ')).toBeVisible();
			await expect(
				page.getByRole('heading', { name: `${HEAD} ${LAST_NAME_MASKED}` })
			).toBeVisible();
			await expect(page.getByText(NATIONAL_ID)).toHaveCount(0);
			await expect(page.getByText(NATIONAL_ID_DASHED)).toHaveCount(0);
		}
	});

	test('finds a person by passport number regardless of letter case', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(PASSPORT.toLowerCase());
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByText('พบข้อมูลทั้งหมด 1 รายการ')).toBeVisible();
		await expect(page.getByRole('heading', { name: `${SOLO} ${LAST_NAME_MASKED}` })).toBeVisible();
		await expect(page.getByText(PASSPORT)).toHaveCount(0);
	});

	test('shows the empty state when nobody matches', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(`${PREFIX}ไม่มีคนนี้`);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByRole('heading', { name: 'ไม่พบรายชื่อ' })).toBeVisible();
		await expect(
			page.getByText('ไม่พบข้อมูลที่ตรงกับการค้นหา กรุณาตรวจสอบความถูกต้องอีกครั้ง')
		).toBeVisible();
	});

	test('searches straight from the ?q= deep link', async ({ page }) => {
		await page.goto(`/search?q=${encodeURIComponent(HEAD)}`);
		await expect(page.getByRole('textbox', { name: SEARCH_BOX })).toHaveValue(HEAD);
		await expect(page.getByText('พบข้อมูลทั้งหมด 1 รายการ')).toBeVisible();
		await expect(page.getByRole('heading', { name: `${HEAD} ${LAST_NAME_MASKED}` })).toBeVisible();
	});

	test('replaces the results when searching again', async ({ page }) => {
		await page.goto('/search');
		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(HEAD);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByRole('heading', { name: `${HEAD} ${LAST_NAME_MASKED}` })).toBeVisible();

		await page.getByRole('textbox', { name: SEARCH_BOX }).fill(SOLO);
		await page.getByRole('button', { name: 'ค้นหา' }).click();
		await expect(page.getByRole('heading', { name: `${SOLO} ${LAST_NAME_MASKED}` })).toBeVisible();
		await expect(page.getByRole('heading', { name: HEAD })).toHaveCount(0);
		await expect(page.getByText('มาเดี่ยว')).toBeVisible();
	});
});
