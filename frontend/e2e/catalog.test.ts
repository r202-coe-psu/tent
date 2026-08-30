import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
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

const sessions: Record<string, string> = {};

test.beforeAll(async () => {
	await createCouchUser(SM);
	await createCouchUser(STAFF);
	sessions[SM.name] = await couchLogin(SM.name, SM.password);
	sessions[STAFF.name] = await couchLogin(STAFF.name, STAFF.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SM.name);
	await deleteCouchUser(STAFF.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Catalog Management — Access Guard', () => {
	test('non-write-privileged user (registration staff) cannot see add button', async ({ page }) => {
		await injectSession(page, STAFF, sessions[STAFF.name]);
		await page.goto('/back-office/catalog?tab=item_master');

		// Wait for data load indicator to disappear or check visibility
		await expect(page.locator('text=รายการข้อมูล')).toBeVisible({ timeout: 8000 });
		await expect(page.getByRole('button', { name: 'เพิ่มข้อมูล' })).not.toBeVisible();
	});
});

test.describe('Catalog Management — Item Master CRUD', () => {
	test('Shelter Manager can create, edit, and delete a consumable item master', async ({
		page
	}) => {
		page.on('console', (msg) => console.log('BROWSER LOG:', msg.text()));
		page.on('requestfailed', (req) =>
			console.log('REQUEST FAILED:', req.url(), req.failure()?.errorText)
		);
		page.on('response', (res) => {
			if (res.status() >= 400) console.log('HTTP ERROR:', res.status(), res.url());
		});
		const itemName = `E2E Consumable ${RUN_ID}`;
		await injectSession(page, SM, sessions[SM.name]);
		await page.goto('/back-office/catalog?tab=item_master');

		await expect(page.locator('text=รายการข้อมูล')).toBeVisible({ timeout: 8000 });
		await page.screenshot({ path: 'test-results/debug-screenshot.png' });

		// 1. Create
		await page.getByRole('button', { name: 'เพิ่มข้อมูล' }).click();

		await expect(page.locator('text=บันทึกข้อมูลตั้งค่ามาตรฐานใหม่')).toBeVisible();

		await page.getByLabel('ชื่อสินค้า (Item Name)').fill(itemName);
		await page.getByLabel('รหัสสินค้า (SKU)').fill(`SKU-${RUN_ID}`);
		await page.getByLabel('รายละเอียด / หมายเหตุ (Description)').fill('Test description for E2E');
		await page.getByLabel('หน่วยที่เล็กที่สุด (Base Unit)').selectOption('ชิ้น');

		await page.getByLabel('อายุการเก็บรักษา (วัน) (Shelf Life Days)').fill('365');
		await page.getByLabel('ประเภทการจัดเก็บ (Storage Type)').selectOption('DRY');
		await page.getByLabel('สารก่อภูมิแพ้ (Allergens)').fill('ถั่ว');
		await page.getByLabel('เพศที่ใช้ได้ (Target Gender)').selectOption('ALL');
		await page.getByLabel('ช่วงวัยที่เหมาะสม (Age Group)').selectOption('ALL');
		await page.getByLabel('ข้อจำกัดด้านอาหาร (Dietary)').selectOption('HALAL');

		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		// Verify success toast and return to list
		await expect(page.getByText(`เพิ่มข้อมูล ${itemName} สำเร็จ`)).toBeVisible({ timeout: 8000 });
		await expect(page.locator('text=รายการข้อมูล')).toBeVisible({ timeout: 8000 });
		await expect(page.locator('table').getByText(itemName)).toBeVisible();

		// 2. Edit & Base Unit Lock Rule verification
		const row = page.locator('tr', { hasText: itemName });
		await row.getByRole('button', { name: 'จัดการ' }).click();

		await expect(page.locator('text=ฐานข้อมูลมาสเตอร์ส่วนกลาง')).toBeVisible();

		// Verify that Base Unit is locked
		const baseUnitSelect = page.getByLabel('หน่วยที่เล็กที่สุด (Base Unit)');
		await expect(baseUnitSelect).toBeDisabled();

		// Modify description and shelf life
		await page
			.getByLabel('รายละเอียด / หมายเหตุ (Description)')
			.fill('Updated description via E2E');
		await page.getByLabel('อายุการเก็บรักษา (วัน) (Shelf Life Days)').fill('180');

		await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();

		await expect(page.getByText(`ปรับปรุงข้อมูล ${itemName} สำเร็จ`)).toBeVisible({
			timeout: 8000
		});
		await expect(page.locator('text=รายการข้อมูล')).toBeVisible({ timeout: 8000 });

		// 3. Delete
		await row.getByRole('button', { name: 'ลบ' }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: 'ยืนยันการลบ' }).click();

		await expect(page.getByText(`ลบรายการ "${itemName}" สำเร็จ`)).toBeVisible({ timeout: 8000 });
		await expect(page.locator('table').getByText(itemName)).not.toBeVisible();
	});
});
