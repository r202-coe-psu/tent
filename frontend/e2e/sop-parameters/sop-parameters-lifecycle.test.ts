import { expect, test, type Page } from '@playwright/test';
import { clearSession } from '../helpers/login';
import {
	activeMasterRatios,
	CATALOG_DB,
	findDocuments,
	foreignActiveOverrides,
	getDocument,
	POINTER_ID,
	routeBrowserCouchThroughApp,
	seedActiveE2eMaster,
	SHELTER_CODE,
	SHELTER_DB,
	switchAccount,
	SYSTEM_SOP_PATH,
	withSopScenario,
	type CouchDocument
} from './sop-parameters';

test.describe.configure({ mode: 'serial' });

test.beforeEach(async ({ page }) => {
	await routeBrowserCouchThroughApp(page);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

const ratioTable = (page: Page) => page.getByRole('region', { name: 'รายการข้อมูล' });
const ratioRow = (page: Page, label: string) =>
	ratioTable(page).getByRole('row').filter({ hasText: label });
const toast = (page: Page, text: string) =>
	page.locator('[data-sonner-toast]').filter({ hasText: text });

async function activeProfileId(): Promise<string | undefined> {
	return (await getDocument(CATALOG_DB, POINTER_ID))?.active_profile_id as string | undefined;
}

async function overridesOf(createdBy: string): Promise<CouchDocument[]> {
	return findDocuments(
		SHELTER_DB,
		(doc) => doc.type === 'sop_override' && doc.created_by === createdBy
	);
}

test('Journey A: system_admin creates, activates, versions and rolls back a master profile', async ({
	page
}) => {
	test.setTimeout(120_000);
	await withSopScenario('master', async (scenario) => {
		const name = `E2E SOP ${scenario.suffix}`;
		const slug = `e2e-sop-${scenario.suffix}`;
		const v1Id = `sop_profile:${slug}:1`;
		const v2Id = `sop_profile:${slug}:2`;
		const baselineId = await activeProfileId();

		await test.step('SA creates a new master profile (saved but not promoted)', async () => {
			await switchAccount(page, scenario.sa);
			await page.getByRole('button', { name: 'สร้าง Master Profile', exact: true }).click();
			const dialog = page.getByRole('dialog');
			await dialog.getByLabel(/ชื่อ Master Profile/).fill(name);
			await dialog.getByLabel('ก๊อกน้ำ', { exact: true }).fill('70');
			await dialog.getByRole('button', { name: 'สร้าง Profile' }).click();

			await expect(toast(page, 'สร้าง Master SOP Profile สำเร็จ')).toBeVisible();
			const v1 = await getDocument(CATALOG_DB, v1Id);
			expect(v1).toMatchObject({ name, slug, version: 1, created_by: scenario.sa.name });
			expect((v1!.ratios as Record<string, string>).people_per_tap).toBe('70');
			if (baselineId) expect(await activeProfileId()).toBe(baselineId);
		});

		await test.step('SA selects it and sets it as the main master', async () => {
			await page.locator('#master-profile').selectOption(slug);
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('70');
			await page.getByRole('button', { name: 'ตั้งเป็น Master หลัก' }).click();

			await expect(toast(page, 'เปิดใช้งานเวอร์ชัน Master SOP สำเร็จ')).toBeVisible();
			await expect(page.getByRole('button', { name: 'กำลังใช้งาน' })).toBeDisabled();
			expect(await activeProfileId()).toBe(v1Id);
		});

		await test.step('Edit form blocks save until a ratio changes and a reason is given', async () => {
			await page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' }).click();
			const dialog = page.getByRole('dialog');
			const save = dialog.getByRole('button', { name: 'บันทึกเวอร์ชันใหม่' });
			const reason = dialog.getByLabel(/เหตุผลในการแก้ไข/);

			await reason.fill('ยังไม่ได้เปลี่ยนค่า');
			await expect(dialog.getByText('ยังไม่มีข้อมูลพารามิเตอร์ใดเปลี่ยนแปลง')).toBeVisible();
			await expect(save).toBeDisabled();

			await reason.fill('');
			await dialog.getByLabel('ก๊อกน้ำ', { exact: true }).fill('120');
			await expect(save).toBeDisabled();

			await reason.fill('E2E เพิ่มอัตราก๊อกน้ำ');
			await expect(save).toBeEnabled();
			await save.click();

			await expect(toast(page, 'บันทึกเวอร์ชัน Master SOP สำเร็จ')).toBeVisible();
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('120');
			await expect(page.getByRole('button', { name: 'ประวัติ (2)' })).toBeVisible();
		});

		await test.step('CouchDB holds an immutable v1, a promoted v2 and its audit reason', async () => {
			const v1 = await getDocument(CATALOG_DB, v1Id);
			const v2 = await getDocument(CATALOG_DB, v2Id);
			expect((v1!.ratios as Record<string, string>).people_per_tap).toBe('70');
			expect((v2!.ratios as Record<string, string>).people_per_tap).toBe('120');
			expect(await activeProfileId()).toBe(v2Id);
			const audits = await findDocuments(
				CATALOG_DB,
				(doc) => doc.type === 'audit' && doc.target_id === v2Id
			);
			expect(audits.map((audit) => audit.reason)).toContain('E2E เพิ่มอัตราก๊อกน้ำ');
		});

		await test.step('History lists both versions and re-activates v1', async () => {
			await page.getByRole('button', { name: 'ประวัติ (2)' }).click();
			const entries = page.locator('ol > li');
			await expect(entries).toHaveCount(2);
			await expect(entries.nth(0)).toContainText(/v2\s*•\s*ปัจจุบัน/);
			await expect(entries.nth(0)).toContainText('E2E เพิ่มอัตราก๊อกน้ำ');
			await expect(entries.nth(0).getByRole('button', { name: 'เปิดใช้งาน' })).toHaveCount(0);

			await entries.nth(1).getByRole('button', { name: 'เปิดใช้งาน' }).click();
			await expect(toast(page, 'เปิดใช้งานเวอร์ชัน Master SOP สำเร็จ')).toBeVisible();
			await expect(entries.nth(1)).toContainText(/v1\s*•\s*ปัจจุบัน/);
			expect(await activeProfileId()).toBe(v1Id);

			await page.getByRole('button', { name: 'Close' }).click();
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('70');
		});
	});
});

test('Journey B: manager overrides SH001, staff sees it, manager cancels it', async ({ page }) => {
	test.setTimeout(150_000);
	await withSopScenario('override', async (scenario) => {
		const foreign = await foreignActiveOverrides(scenario);
		test.skip(
			foreign.length > 0,
			`${SHELTER_CODE} already has an active override (${foreign[0]?._id}) — not owned by E2E`
		);
		const master = await seedActiveE2eMaster(scenario, {
			...(await activeMasterRatios()),
			people_per_tap: '90'
		});

		await test.step('Manager sees the active master and creates an SH001 override', async () => {
			await switchAccount(page, scenario.manager);
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('90');

			await page.getByRole('button', { name: 'ปรับแต่งเฉพาะศูนย์' }).click();
			await expect(page.getByText(`ยังไม่มีการปรับแต่งสำหรับศูนย์ ${SHELTER_CODE}`)).toBeVisible();
			await page.getByRole('button', { name: 'สร้างค่าปรับแต่งเฉพาะศูนย์' }).click();

			await expect(toast(page, 'สร้างค่าปรับแต่งเฉพาะศูนย์สำเร็จ')).toBeVisible();
			await expect(page.getByRole('heading', { name: 'ค่าปรับแต่งเฉพาะศูนย์' })).toBeVisible();
			const [override] = await overridesOf(scenario.manager.name);
			expect(override).toMatchObject({
				shelter_code: SHELTER_CODE,
				base_profile_id: master._id,
				version: 1,
				active: true
			});
		});

		await test.step('Manager edits the override into a new version', async () => {
			await page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog.getByText('แก้ไข Override SOP Profile')).toBeVisible();
			await dialog.getByLabel('ก๊อกน้ำ', { exact: true }).fill('60');
			await dialog.getByLabel(/เหตุผลในการแก้ไข/).fill('E2E ก๊อกน้ำชั่วคราวเพิ่ม');
			await dialog.getByRole('button', { name: 'บันทึกเวอร์ชันใหม่' }).click();

			await expect(toast(page, 'บันทึกเวอร์ชัน Override SOP สำเร็จ')).toBeVisible();
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('60');
			const active = (await overridesOf(scenario.manager.name)).filter((doc) => doc.active);
			expect(active.map((doc) => doc.version)).toEqual([2]);
		});

		await test.step('Staff of SH001 sees the override read-only', async () => {
			await switchAccount(page, scenario.staff);
			await page.getByRole('button', { name: 'ปรับแต่งเฉพาะศูนย์' }).click();
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('60');
			await expect(page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'ยกเลิกค่าปรับแต่ง' })).toHaveCount(0);
		});

		await test.step('Manager cancels the override after confirming', async () => {
			await switchAccount(page, scenario.manager);
			await page.getByRole('button', { name: 'ปรับแต่งเฉพาะศูนย์' }).click();
			await page.getByRole('button', { name: 'ยกเลิกค่าปรับแต่ง' }).click();
			const confirm = page.getByRole('dialog', { name: 'ยืนยันการยกเลิกค่าปรับแต่ง' });
			await expect(confirm).toContainText(SHELTER_CODE);
			await confirm.getByRole('button', { name: 'ยืนยัน' }).click();

			await expect(toast(page, 'ยกเลิกค่าปรับแต่งเฉพาะศูนย์สำเร็จ')).toBeVisible();
			await expect(page.getByRole('heading', { name: 'ตัวแปรมาตรฐาน Sphere' })).toBeVisible();
			const active = (await overridesOf(scenario.manager.name)).filter((doc) => doc.active);
			expect(active).toHaveLength(0);
		});

		await test.step('Staff falls back to the master value', async () => {
			await switchAccount(page, scenario.staff);
			await expect(ratioRow(page, 'ก๊อกน้ำ')).toContainText('90');
			await page.getByRole('button', { name: 'ปรับแต่งเฉพาะศูนย์' }).click();
			await expect(page.getByText('สิทธิ์การเข้าใช้งานของคุณเป็นแบบอ่านอย่างเดียว')).toBeVisible();
			await expect(page.getByRole('button', { name: 'สร้างค่าปรับแต่งเฉพาะศูนย์' })).toHaveCount(0);
		});
	});
});

test('Journey C: staff and manager cannot manage master profiles', async ({ page }) => {
	test.setTimeout(90_000);
	await withSopScenario('rbac', async (scenario) => {
		await test.step('Staff is redirected away from the global baseline page', async () => {
			await switchAccount(page, scenario.staff);
			await page.goto(SYSTEM_SOP_PATH);
			await expect(page).toHaveURL(/\/portal$/, { timeout: 10_000 });
		});

		await test.step('Staff sees master ratios without any edit control', async () => {
			await switchAccount(page, scenario.staff);
			await expect(ratioTable(page).locator('tbody tr').first()).toBeVisible();
			await expect(page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: /สร้าง Master Profile/ })).toHaveCount(0);
		});

		await test.step('Staff can filter the ratio table by label', async () => {
			const rows = ratioTable(page).locator('tbody tr');
			const search = ratioTable(page).getByRole('searchbox', { name: 'ค้นหา' });
			const allRows = await rows.count();

			await search.fill('ห้องน้ำ');
			await expect(rows).toHaveCount(2);
			await expect(ratioRow(page, 'ห้องน้ำหญิง')).toBeVisible();

			await search.fill('ไม่มีรายการนี้');
			await expect(ratioTable(page).getByText('ไม่พบรายการที่ต้องการค้นหา')).toBeVisible();

			await search.fill('');
			await expect(rows).toHaveCount(allRows);
		});

		await test.step('Manager has no master profile controls', async () => {
			await switchAccount(page, scenario.manager);
			await expect(page.locator('#master-profile')).toHaveCount(0);
			await expect(page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: /สร้าง Master Profile/ })).toHaveCount(0);
		});

		await test.step('SA on the global baseline page has no shelter context', async () => {
			await switchAccount(page, scenario.sa, SYSTEM_SOP_PATH);
			await expect(page.getByRole('button', { name: '✏ แก้ไขพารามิเตอร์' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ปรับแต่งเฉพาะศูนย์' })).toBeDisabled();
		});
	});
});
