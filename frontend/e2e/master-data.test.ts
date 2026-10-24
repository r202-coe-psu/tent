/**
 * E2E Tests: Master Data hub (`/back-office/master-data`) — CR-010 UI.
 *
 * Strategy: real auth (CouchDB session cookies via injectSession), but the
 * `/api/back-office/master-data/*` BFF is fully mocked (`mockMasterData`).
 * Reason: unlike per-test users, master_data docs are 1 global doc per
 * `master_type` — real writes would race across parallel test workers/files.
 *
 * Coverage:
 * [Guard]     non-manager is redirected away from the page
 * [Hub]       sidebar shows all 6 types; type query selects the panel
 * [Scope]     global-only chronic_disease / allergy are read-only in back-office (CR-186, CR-187)
 * [CRUD]      add → edit round-trips through the mocked BFF
 * [Redirect]  legacy URLs land on the hub with the correct `?type=`
 */

import { test, expect, type Page, type Route } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	seedSecurityQuestion,
	SA_ROLES,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession, routeBrowserCouchThroughApp } from './helpers/login';

const BASE = 'http://localhost:4173';
const API_PATTERN = '**/api/back-office/master-data**';
const HUB_PATH = '/back-office/master-data';

const SHORT_TITLES: Record<string, string> = {
	vulnerable_group: 'กลุ่มเปราะบาง',
	housing_type: 'ประเภทที่อยู่',
	shelter_type: 'ประเภทศูนย์',
	volunteer_skills: 'ทักษะอาสา',
	chronic_disease: 'โรคประจำตัว',
	allergy: 'อาการแพ้'
};

type MockItem = {
	code: string;
	label_th: string;
	label_en: string;
	is_default: boolean;
	status?: 'active' | 'inactive';
	category?: string;
	description?: string;
};
type MockStore = Map<string, MockItem[]>;

async function mockMasterData(page: Page, seed: Record<string, MockItem[]>): Promise<MockStore> {
	const store: MockStore = new Map(Object.entries(seed));

	await page.route(API_PATTERN, async (route: Route) => {
		const req = route.request();
		const url = new URL(req.url());
		const method = req.method();
		const rest = url.pathname.replace(/^.*\/api\/back-office\/master-data\/?/, '');
		const segments = rest.split('/').filter(Boolean).map(decodeURIComponent);

		if (segments.length === 0 && method === 'GET') {
			const body = [...store.entries()].map(([type, items]) => ({
				_id: `master_data:${type}`,
				master_type: type,
				items
			}));
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(body)
			});
			return;
		}

		const [type, sub, code] = segments;

		if (segments.length === 1 && method === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					_id: `master_data:${type}`,
					master_type: type,
					items: store.get(type) ?? []
				})
			});
			return;
		}

		if (segments.length === 1 && method === 'PUT') {
			const body = req.postDataJSON() as { items: MockItem[] };
			store.set(type, body.items);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '1-mock' })
			});
			return;
		}

		if (segments.length === 3 && sub === 'items' && method === 'DELETE') {
			store.set(
				type,
				(store.get(type) ?? []).filter((i) => i.code !== code)
			);
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true, rev: '2-mock' })
			});
			return;
		}

		await route.continue();
	});

	return store;
}

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SA = {
	name: `md_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'MD SA'
};
const STAFF = {
	name: `md_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'MD Staff'
};

const sessions: Record<string, string> = {};

test.beforeAll(async () => {
	await createCouchUser(SA);
	await createCouchUser(STAFF);
	// Skip the CR-105 first-login force-setup gate so the hub itself is under test.
	await seedSecurityQuestion(SA.name);
	await seedSecurityQuestion(STAFF.name);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
	sessions[STAFF.name] = await couchLogin(STAFF.name, STAFF.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SA.name);
	await deleteCouchUser(STAFF.name);
});

// Back-office pages read the shelter list from CouchDB; the test build calls it cross-origin.
test.beforeEach(async ({ page }) => {
	await routeBrowserCouchThroughApp(page);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Master Data hub', () => {
	test('redirects a non-manager user away from the page', async ({ page }) => {
		await injectSession(page, STAFF, sessions[STAFF.name]);
		await mockMasterData(page, {});
		await page.goto(`${BASE}${HUB_PATH}`);
		await expect(page).toHaveURL(`${BASE}/portal`, { timeout: 8000 });
	});

	test('renders the hub with all 6 type sidebar entries', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, {
			vulnerable_group: [],
			housing_type: [],
			shelter_type: [],
			volunteer_skills: [],
			chronic_disease: [],
			allergy: []
		});
		await page.goto(`${BASE}${HUB_PATH}`);

		await expect(page.getByRole('heading', { level: 1, name: 'Master Data' })).toBeVisible();

		for (const shortTitle of Object.values(SHORT_TITLES)) {
			await expect(
				page.getByRole('navigation', { name: 'ประเภท Master Data' }).getByText(shortTitle).first()
			).toBeVisible();
		}
	});

	test('supports add and edit of an item', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, { vulnerable_group: [] });
		await page.goto(`${BASE}${HUB_PATH}?type=vulnerable_group`);

		await page.getByRole('button', { name: 'เพิ่มรายการ' }).first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.locator('#master-data-code').fill('test_add_item');
		await page.locator('#master-data-label-th').fill('รายการทดสอบ Add');
		await page.locator('#master-data-label-en').fill('Test Add Item');
		await page.getByRole('button', { name: 'บันทึก' }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
		await expect(page.getByText('รายการทดสอบ Add')).toBeVisible();

		await page.getByRole('button', { name: 'แก้ไข รายการทดสอบ Add' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.locator('#master-data-label-th').fill('รายการทดสอบ Edited');
		await page.locator('#master-data-label-en').fill('Test Edited Item');
		await page.getByRole('button', { name: 'บันทึก' }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });
		await expect(page.getByText('รายการทดสอบ Edited')).toBeVisible();
		await expect(page.getByText('รายการทดสอบ Add')).not.toBeVisible();
	});

	test('back-office shows global-only chronic_disease read-only (CR-186)', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, {
			chronic_disease: [
				{ code: 'diabetes', label_th: 'เบาหวาน', label_en: 'Diabetes', is_default: false }
			]
		});
		await page.goto(`${BASE}${HUB_PATH}?type=chronic_disease`);

		await expect(page.getByText('เบาหวาน')).toBeVisible();
		await expect(
			page.getByText('ดูได้อย่างเดียว — ประเภทนี้จัดการที่ส่วนกลางเท่านั้น')
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'เพิ่มรายการ' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'แก้ไข เบาหวาน' })).toHaveCount(0);
	});

	test('back-office shows global-only allergy read-only (CR-187)', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, {
			allergy: [{ code: 'egg', label_th: 'ไข่', label_en: 'Egg', is_default: false }]
		});
		await page.goto(`${BASE}${HUB_PATH}?type=allergy`);

		await expect(page.getByText('ไข่', { exact: true })).toBeVisible();
		await expect(
			page.getByText('ดูได้อย่างเดียว — ประเภทนี้จัดการที่ส่วนกลางเท่านั้น')
		).toBeVisible();
		await expect(page.getByRole('button', { name: 'เพิ่มรายการ' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'แก้ไข ไข่' })).toHaveCount(0);
	});

	test('system management can add chronic_disease items (CR-186)', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, { chronic_disease: [] });
		await page.goto(`${BASE}/system-management/master-data?type=chronic_disease`);

		await expect(page.getByRole('button', { name: 'เพิ่มรายการ' }).first()).toBeVisible();
		await expect(page.getByText('ดูได้อย่างเดียว')).toHaveCount(0);
	});

	test('legacy registration-config redirects to hub with vulnerable_group', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, { vulnerable_group: [] });
		await page.goto(`${BASE}/back-office/registration-config`);
		await expect(page).toHaveURL(new RegExp(`${HUB_PATH}\\?type=vulnerable_group`), {
			timeout: 8000
		});
	});

	test('legacy volunteer-skills redirects to hub with volunteer_skills', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockMasterData(page, { volunteer_skills: [] });
		await page.goto(`${BASE}/back-office/volunteer-skills`);
		await expect(page).toHaveURL(new RegExp(`${HUB_PATH}\\?type=volunteer_skills`), {
			timeout: 8000
		});
	});
});
