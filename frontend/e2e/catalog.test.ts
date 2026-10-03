import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	COUCH_BASE,
	SA_ROLES,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SM = {
	name: `catalog_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Catalog Manager SM'
};
const STAFF = {
	name: `catalog_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Catalog Staff'
};

const SA = {
	name: `catalog_sa_${RUN_ID}`,
	password: 'Password1!',
	roles: SA_ROLES,
	display_name: 'Catalog System Admin'
};

const sessions: Record<string, string> = {};

const APP_BASE_URL = 'http://localhost:4173';

/** The browser talks to CouchDB directly; send it through the app's same-origin proxy. */
async function routeBrowserCouchThroughApp(page: Page): Promise<void> {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const corsHeaders = {
			'access-control-allow-origin': APP_BASE_URL,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept'
		};
		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}
		const response = await route.fetch({
			url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
		});
		await route.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } });
	});
}

/** Master data lives in the "สินค้า (Master)" tab of the shelter supply page. */
const CATALOG_URL = '/back-office/supply?tab=catalog';

/**
 * A freshly minted user has no `security_question`, and the post-login gate sends
 * anyone in that state to `/force-setup` before any back-office route renders.
 */
async function seedSecurityQuestion(name: string): Promise<void> {
	const path = `/_users/org.couchdb.user:${encodeURIComponent(name)}`;
	const got = await couchReq('GET', path);
	const doc = got.data as Record<string, unknown>;
	const res = await couchReq('PUT', path, {
		...doc,
		security_question: {
			question_id: 'high_school',
			answer_hash: 'e2e'.padEnd(64, '0'),
			salt: 'e2e'.padEnd(32, '0'),
			set_at: new Date().toISOString()
		},
		must_change_password: false
	});
	if (res.status >= 400) {
		throw new Error(`Could not seed security question for "${name}" (HTTP ${res.status})`);
	}
}

test.beforeAll(async () => {
	await createCouchUser(SM);
	await createCouchUser(STAFF);
	await createCouchUser(SA);
	await seedSecurityQuestion(SA.name);
	await seedSecurityQuestion(SM.name);
	await seedSecurityQuestion(STAFF.name);
	sessions[SM.name] = await couchLogin(SM.name, SM.password);
	sessions[STAFF.name] = await couchLogin(STAFF.name, STAFF.password);
	sessions[SA.name] = await couchLogin(SA.name, SA.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SM.name);
	await deleteCouchUser(STAFF.name);
	await deleteCouchUser(SA.name);
});

test.afterEach(async ({ page }) => {
	// Let in-flight CouchDB proxy callbacks settle instead of failing the test on teardown.
	await page.unrouteAll({ behavior: 'ignoreErrors' });
	await clearSession(page);
});

test.describe('Master data — access guard', () => {
	test('registration staff cannot open the supply page or add items', async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, STAFF, sessions[STAFF.name]);
		await page.goto(CATALOG_URL);

		await expect(page).not.toHaveURL(/\/back-office\/supply/, { timeout: 10_000 });
		await expect(page.getByRole('button', { name: 'เพิ่มสินค้า' })).toHaveCount(0);
	});
});

test.describe('Master data — item CRUD', () => {
	test('Shelter Manager can create, find, edit and deactivate a shelter item', async ({ page }) => {
		const itemName = `E2E Item ${RUN_ID}`;
		const renamed = `${itemName} (แก้ไข)`;
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, SM, sessions[SM.name]);
		await page.goto(CATALOG_URL);
		await expect(page.getByRole('tab', { name: 'รายการสินค้า' })).toBeVisible({ timeout: 8000 });

		// 1. Create from the header button; the item form opens in the side sheet.
		await page.getByRole('button', { name: 'เพิ่มสินค้า' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { name: 'เพิ่มสินค้า' })).toBeVisible();

		await sheet.getByPlaceholder('เช่น ข้าวสาร, น้ำดื่ม').fill(itemName);
		const category = sheet.getByLabel('หมวดสินค้า');
		if (!(await category.inputValue())) await category.selectOption({ index: 1 });

		await sheet.getByText('-- เลือกหน่วย --').click();
		await page.getByRole('option').filter({ hasText: 'ชิ้น' }).first().click();

		await sheet.getByRole('button', { name: 'บันทึก', exact: true }).click();
		await expect(page.getByText(`เพิ่มข้อมูล ${itemName} สำเร็จ`)).toBeVisible({ timeout: 8000 });

		// 2. Find it with the search box, then open its detail sheet.
		await page.getByPlaceholder('ค้นหาชื่อ / SKU').fill(itemName);
		const row = page.getByRole('row').filter({ hasText: itemName });
		await expect(row).toBeVisible();
		await expect(row.getByText('เฉพาะศูนย์')).toBeVisible();
		await row.getByRole('button', { name: itemName }).click();

		const detail = page.getByRole('dialog');
		await expect(detail.getByRole('heading', { name: itemName })).toBeVisible();
		await expect(detail.getByText('รหัสสินค้า (SKU)')).toBeVisible();

		// 3. Edit inside the same sheet.
		await detail.getByRole('button', { name: 'แก้ไข', exact: true }).click();
		await expect(detail.getByRole('heading', { name: 'แก้ไขสินค้า' })).toBeVisible();
		await detail.getByPlaceholder('เช่น ข้าวสาร, น้ำดื่ม').fill(renamed);
		await detail.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
		await expect(page.getByText(`ปรับปรุงข้อมูล ${renamed} สำเร็จ`)).toBeVisible({
			timeout: 8000
		});
		await expect(detail.getByRole('heading', { name: renamed })).toBeVisible();

		// 4. Deactivate (a never-stocked shelter item is removed outright).
		await detail.getByRole('button', { name: 'ปิดใช้งาน' }).click();
		await page.getByRole('button', { name: 'ยืนยันปิดใช้งาน' }).click();
		await expect(
			page.getByText(/ลบรายการ ".*" สำเร็จ|เปลี่ยนสถานะรายการ ".*" เป็นปิดใช้งานแล้ว/)
		).toBeVisible({ timeout: 8000 });
	});
});

test.describe('Master data — categories, units and recipes', () => {
	test('Shelter Manager sees the category tab and the recipe form sheet', async ({ page }) => {
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, SM, sessions[SM.name]);

		await page.goto(CATALOG_URL);
		await page.getByRole('tab', { name: 'หมวดสินค้า' }).click();
		await expect(page.getByRole('button', { name: 'เพิ่มหมวด' })).toBeVisible({ timeout: 8000 });

		await page.goto('/back-office/catalog');
		await expect(page.getByRole('heading', { name: 'สูตรอาหารมาตรฐาน' })).toBeVisible({
			timeout: 8000
		});
		await page.getByRole('button', { name: 'เพิ่มสูตรอาหาร' }).click();
		await expect(
			page.getByRole('dialog').getByRole('heading', { name: 'เพิ่มสูตรอาหารมาตรฐาน (BOM)' })
		).toBeVisible();
	});

	test('System Admin can add and delete a unit of measure in the side sheet', async ({ page }) => {
		const code = `e2e${RUN_ID}`.toLowerCase();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, SA, sessions[SA.name]);
		await page.goto('/system-management/catalog?tab=units');

		await expect(page.getByRole('heading', { name: /หน่วยนับมาตรฐาน/ })).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: 'เพิ่มหน่วยนับ' }).click();
		const sheet = page.getByRole('dialog');
		await expect(sheet.getByRole('heading', { name: 'เพิ่มหน่วยนับใหม่' })).toBeVisible();

		await sheet.getByLabel(/รหัสหน่วย/).fill(code);
		await sheet.getByLabel(/ชื่อภาษาไทย/).fill(`หน่วยทดสอบ ${RUN_ID}`);
		await sheet.getByLabel(/ชื่อภาษาอังกฤษ/).fill(`E2E unit ${RUN_ID}`);
		await sheet.getByRole('button', { name: 'บันทึกหน่วยนับ' }).click();
		await expect(page.getByText(/เพิ่มหน่วยนับ ".*" สำเร็จ/)).toBeVisible({ timeout: 8000 });

		await page.getByPlaceholder(/ค้นหารหัส/).fill(code);
		const row = page.getByRole('row').filter({ hasText: code });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: 'ลบ' }).click();
		await page.getByRole('button', { name: 'ยืนยันการลบ' }).click();
		await expect(page.getByText(`ลบหน่วยนับ "${code}" เรียบร้อยแล้ว`)).toBeVisible({
			timeout: 8000
		});
	});
});
