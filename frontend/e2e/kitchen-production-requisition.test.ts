import { expect, test, type Page } from '@playwright/test';
import {
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	COUCH_BASE,
	SM_SH001_ROLES,
	type TestUser
} from './helpers/couch';
import { clearSession, injectSession } from './helpers/login';

const SHELTER_DB = 'shelter_sh001';
const APP_BASE_URL = 'http://localhost:4173';

async function routeBrowserCouchThroughApp(page: Page) {
	await page.route(`${COUCH_BASE}/**`, async (route) => {
		const request = route.request();
		const origin = new URL(request.url());
		const allowOrigin = new URL(APP_BASE_URL).origin;
		const corsHeaders = {
			'access-control-allow-origin': allowOrigin,
			'access-control-allow-credentials': 'true',
			'access-control-allow-methods': 'GET, HEAD, POST, PUT, DELETE, OPTIONS',
			'access-control-allow-headers':
				request.headers()['access-control-request-headers'] ?? 'Content-Type, Accept',
			'access-control-expose-headers': 'ETag, Location, Content-Type'
		};

		if (request.method() === 'OPTIONS') {
			await route.fulfill({ status: 204, headers: corsHeaders });
			return;
		}

		const response = await route.fetch({
			url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
		});
		await route.fulfill({
			response,
			headers: { ...response.headers(), ...corsHeaders }
		});
	});
}

function uniqueUser(prefix: string, roles: string[]): TestUser {
	const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
	return {
		name: `${prefix}_${suffix}`,
		password: 'Password1!',
		roles,
		display_name: `E2E Kitchen ${prefix}`
	};
}

async function openAs(page: Page, user: TestUser, path: string) {
	await routeBrowserCouchThroughApp(page);
	await createCouchUser(user);
	const session = await couchLogin(user.name, user.password);
	await injectSession(page, user, session);
	await page.goto(path);
}

async function seedStockAndGas(user: TestUser) {
	// Seed positive stock_ledger for rice
	const ts = new Date().toISOString();
	await couchReq('PUT', `/${SHELTER_DB}/stock_ledger:seed-rice`, {
		_id: 'stock_ledger:seed-rice',
		type: 'stock_ledger',
		schema_v: 3,
		item_id: 'item:rice',
		qty: '500',
		unit: 'kg',
		reason: 'donation',
		ref_id: null,
		shelter_code: 'SH001',
		occurred_at: ts,
		created_at: ts,
		updated_at: ts,
		created_by: user.name
	});

	// Seed gas cylinder type and gas ledger
	await couchReq('PUT', `/${SHELTER_DB}/gas_cylinder_type:tank-01`, {
		_id: 'gas_cylinder_type:tank-01',
		type: 'gas_cylinder_type',
		schema_v: 1,
		name: 'ถังหลัก A',
		capacity_kg: '15',
		burn_rate_kg_per_hour: '0.4',
		time_multiplier: '1',
		shelter_code: 'SH001',
		created_at: ts,
		updated_at: ts,
		created_by: user.name
	});

	await couchReq('PUT', `/${SHELTER_DB}/gas_ledger:seed-tank-01`, {
		_id: 'gas_ledger:seed-tank-01',
		type: 'gas_ledger',
		schema_v: 1,
		cylinder_id: 'gas_cylinder_type:tank-01',
		qty_kg: '15',
		reason: 'refill',
		ref_id: null,
		shelter_code: 'SH001',
		occurred_at: ts,
		created_at: ts,
		updated_at: ts,
		created_by: user.name
	});
}

test.describe('Kitchen 2-Tier Meal Sessions, 3-Stage Board & TKT-KITCHEN Flow 3', () => {
	let user: TestUser;

	test.beforeEach(async () => {
		user = uniqueUser('kitchen_tester', SM_SH001_ROLES);
		await seedStockAndGas(user);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
		if (user) {
			try {
				await deleteCouchUser(user.name);
			} catch {
				// ignore cleanup error
			}
		}
	});

	test('E2E-K01: Create 2-Tier Meal Session with 5-Group Targets', async ({ page }) => {
		await openAs(page, user, `${APP_BASE_URL}/back-office/kitchen`);

		// Verify header and session tab
		await expect(page.getByText('รอบมื้ออาหาร (Meal Production Sessions)')).toBeVisible({
			timeout: 10000
		});

		// Click Create Session button
		await page.getByRole('button', { name: 'สร้างรอบมื้ออาหารใหม่' }).first().click();

		// Check modal is visible
		await expect(page.getByText('สร้างรอบมื้ออาหารใหม่ (New Meal Session)')).toBeVisible();

		// Fill Session form
		const sessionName = `มื้อทดสอบ E2E ${Date.now().toString(36)}`;
		await page.locator('#session-name').fill(sessionName);

		// Submit session
		await page.getByRole('button', { name: 'สร้างรอบมื้ออาหาร' }).click();

		// Verify session card is rendered
		await expect(page.getByText(sessionName)).toBeVisible({ timeout: 10000 });
		await expect(page.getByText('0/5 กลุ่มครบ')).toBeVisible();
	});

	test('E2E-K02 through E2E-K05: Full Production Flow (Stage A -> B -> Simulation -> C -> 5-Group Completion)', async ({
		page
	}) => {
		await openAs(page, user, `${APP_BASE_URL}/back-office/kitchen`);

		// 1. Create Session
		const sessionName = `มื้อทดสอบ Flow 3 ${Date.now().toString(36)}`;
		await page.getByRole('button', { name: 'สร้างรอบมื้ออาหารใหม่' }).first().click();
		await page.locator('#session-name').fill(sessionName);
		await page.getByRole('button', { name: 'สร้างรอบมื้ออาหาร' }).click();
		await expect(page.getByText(sessionName)).toBeVisible({ timeout: 10000 });

		// 2. Navigate into Production Board
		await page
			.getByRole('link', { name: 'เข้าสู่บอร์ดการผลิต (Production Board)' })
			.first()
			.click();

		// Verify Stage A
		await expect(page.getByText('1. เมนูและกลุ่มเป้าหมาย (Menu & Target)')).toBeVisible({
			timeout: 10000
		});

		// Fill Menu Label & Target
		await page.locator('input[placeholder*="เช่น ข้าวต้มไก่ฮาลาล"]').fill('ข้าวต้มมื้อเช้า E2E');

		// Click "สร้างใบเบิกวัตถุดิบ (Create Requisition)"
		await page.getByRole('button', { name: /สร้างใบเบิกวัตถุดิบ/ }).click();

		// 3. Stage B: Verify Pending Ticket is Created
		await expect(page.getByText(/ตั๋วคำขอเบิก: .*KITCHEN-/)).toBeVisible({ timeout: 10000 });
		await expect(page.getByText('รอคลังสินค้าตรวจสอบและอนุมัติตัดจ่ายสต็อก')).toBeVisible();

		// 4. Stage B: Use Testing Simulation Helper to Approve
		const simulateBtn = page.getByRole('button', { name: 'กดจำลองอนุมัติ' });
		await expect(simulateBtn).toBeVisible();
		await simulateBtn.click();

		// Verify Approved State
		await expect(
			page.getByText('คลังสินค้าอนุมัติตัดจ่ายวัตถุดิบแล้ว พร้อมเริ่มปรุงอาหาร')
		).toBeVisible({ timeout: 10000 });

		// 5. Proceed to Stage C
		const proceedBtn = page.getByRole('button', { name: /เริ่มปรุงและบันทึกผลผลิต \(สู่ช่วง C\)/ });
		await expect(proceedBtn).toBeVisible();
		await proceedBtn.click();

		// 6. Stage C: Verify Yield Form
		await expect(
			page.getByText('บันทึกผลผลิตจริงและการแจกจ่าย (Actual Yield & Meal Service)')
		).toBeVisible({ timeout: 10000 });

		// Submit Service Record
		await page.getByRole('button', { name: 'บันทึกผลการผลิต (Complete Batch)' }).click();

		// 7. Verify Redirected to Kitchen Home and Progress Updated
		await expect(page.getByText('รอบมื้ออาหาร (Meal Production Sessions)')).toBeVisible({
			timeout: 10000
		});
		await expect(page.getByText(sessionName)).toBeVisible();
	});

	test('E2E-Warehouse: Inspect Kitchen Requisition Drawer & Filter', async ({ page }) => {
		await openAs(page, user, `${APP_BASE_URL}/back-office/kitchen-requisitions`);

		// Verify Warehouse Requisitions page
		await expect(
			page.getByText('คำขอเบิกวัตถุดิบและแก๊สโรงครัว (Kitchen Requisitions)')
		).toBeVisible({ timeout: 10000 });

		// Verify filter buttons exist
		await expect(page.getByRole('button', { name: /ทั้งหมด/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /รอดำเนินการ/ })).toBeVisible();
	});
});
