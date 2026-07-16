/**
 * E2E: Evacuee Registration — full 6-step happy path in a single continuous run
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  Step 1 – ตรวจสอบประวัติ   (evacuee search / history check)              │
 * │  Step 2 – ประเมินอาการ      (EWAR symptom assessment)                     │
 * │  Step 3 – ข้อมูลผู้ประสบภัย (evacuee registration form)                  │
 * │  Step 4 – ข้อมูลครัวเรือน  (household search → register a new household) │
 * │  Step 5 – ทรัพย์สินและสัตว์เลี้ยง (pets, assets, vehicles — left empty)  │
 * │  Step 6 – จัดสรรพื้นที่    (zone assignment)                             │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * This suite intentionally has ONE test that drives the wizard from step 1 to
 * the wristband success screen without ever clearing the session in between —
 * every step depends on state (the registered evacuee, the new household)
 * built up by the previous one, so splitting into many isolated tests would
 * either duplicate the whole setup per step or lose that state.
 *
 * Run headed (open browser):
 *   pnpm playwright test e2e/register-evacuee-full.test.ts --headed
 *
 * Slow-motion for demos:
 *   PW_SLOWMO=500 pnpm playwright test e2e/register-evacuee-full.test.ts --headed
 */

import { test, expect } from '@playwright/test';
import { createCouchUser, deleteCouchUser, couchLogin, STAFF_SH001_ROLES } from './helpers/couch';
import { injectSession } from './helpers/login';
import { mockCouchRoutes } from './helpers/mock-couch';

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36);

const TEST_USER = {
	name: `reg_evacuee_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Reg Staff E2E'
};

// ─── Deterministic fixtures (stable failure output across runs) ────────────────

const FIRST_NAME = 'สมชาย';
const LAST_NAME = 'ใจดี';
const ADDRESS_NO = '12/3';
const VILLAGE_NO = 'หมู่ 2';
const SUBDISTRICT = 'บ้านพรุ';
const DISTRICT = 'หาดใหญ่';
const PROVINCE = 'สงขลา';
const POSTAL_CODE = '90250';

// ─── Test suite ────────────────────────────────────────────────────────────────

test.describe('Evacuee Registration', () => {
	let authSession: string;

	test.beforeAll(async () => {
		// Arrange: create a temporary CouchDB user scoped to SH001
		await createCouchUser(TEST_USER);
		authSession = await couchLogin(TEST_USER.name, TEST_USER.password);
	});

	test.afterAll(async () => {
		// Cleanup: remove the temp user so it doesn't pollute subsequent runs
		await deleteCouchUser(TEST_USER.name);
	});

	test('should complete evacuee registration end-to-end across all 6 steps', async ({ page }) => {
		// Arrange — mount the shared mocks (helpers/mock-couch.ts) before navigation,
		// then land on the wizard already authenticated (no login-form / logout
		// roundtrip needed for this flow). The registry shelter fixture is needed
		// for step 6's zone recommendation/selection.
		await mockCouchRoutes(page, { withRegistryShelter: true });
		await injectSession(page, TEST_USER, authSession);
		await page.goto('/onsite/people');

		// ── Step 1: ตรวจสอบประวัติ — history check ──────────────────────────
		await expect(page.getByRole('heading', { name: 'ตรวจสอบประวัติการลงทะเบียน' })).toBeVisible({
			timeout: 15_000
		});
		await page.getByRole('button', { name: 'ลงทะเบียนใหม่' }).first().click();

		// ── Step 2: ประเมินอาการ — mark as healthy, no EWAR symptoms ────────
		await expect(page.getByRole('button', { name: /ไม่มีอาการป่วย/ })).toBeVisible({
			timeout: 5_000
		});
		await page.getByRole('button', { name: /ไม่มีอาการป่วย/ }).click();
		await page.getByRole('button', { name: 'ถัดไป →' }).click();

		// ── Step 3: ข้อมูลผู้ประสบภัย — minimal valid registration form ──────
		await expect(page.getByText('ชื่อ (First Name)')).toBeVisible({ timeout: 5_000 });
		await page.getByPlaceholder('ชื่อจริง').fill(FIRST_NAME);
		await page.getByPlaceholder('นามสกุล', { exact: true }).fill(LAST_NAME);
		await page
			.locator('[data-slot="form-item"]')
			.filter({ has: page.locator('label', { hasText: 'เพศ' }) })
			.locator('[data-slot="select-trigger"]')
			.click();
		await page.getByRole('option', { name: /ชาย \(Male\)/ }).click();
		await page.getByText('ไม่มีเบอร์โทร').click();
		await page.getByRole('button', { name: 'ถัดไป →' }).click();

		// ── Step 4: ข้อมูลครัวเรือน — no match found → register a new household ──
		await expect(page.getByRole('button', { name: 'ค้นหาครอบครัว' })).toBeVisible({
			timeout: 10_000
		});
		await page.getByPlaceholder('089-999-9999').fill(`ไม่พบครอบครัว-${RUN_ID}`);
		await page.getByRole('button', { name: 'ค้นหาครอบครัว' }).click();
		await expect(page.getByText('ไม่พบครอบครัวลงทะเบียนด้วยข้อมูลนี้ในระบบ')).toBeVisible({
			timeout: 5_000
		});
		await page.getByRole('button', { name: 'ลงทะเบียนเป็นครอบครัวใหม่ที่อยู่นี้' }).click();
		await page.getByPlaceholder('เช่น 12/3').fill(ADDRESS_NO);
		await page.getByPlaceholder('เช่น หมู่ 2').fill(VILLAGE_NO);
		await page.getByPlaceholder('เช่น บ้านพรุ').fill(SUBDISTRICT);
		await page.getByPlaceholder('เช่น หาดใหญ่').fill(DISTRICT);
		await page.getByPlaceholder('เช่น สงขลา').fill(PROVINCE);
		await page.getByPlaceholder('เช่น 90250').fill(POSTAL_CODE);
		await page.getByRole('button', { name: 'ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)' }).click();

		// ── Step 5: ทรัพย์สินและสัตว์เลี้ยง — nothing to declare, submit as-is ──
		await expect(page.getByText('ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)')).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: 'ลงทะเบียนสำเร็จ' }).click();

		// Assert — evacuee creation and household-link toasts both fire (this
		// step registers the evacuee, then links it to the new household)
		await expect(page.getByText(`Registered ${FIRST_NAME} ${LAST_NAME}`)).toBeVisible({
			timeout: 8_000
		});
		await expect(page.getByText('ลงทะเบียนผู้ประสบภัยและครัวเรือนสำเร็จ')).toBeVisible({
			timeout: 8_000
		});

		// ── Step 6: จัดสรรพื้นที่ — confirm the auto-recommended zone ─────────
		await expect(page.getByText('จัดสรรพื้นที่ (Zoning)')).toBeVisible({ timeout: 10_000 });
		const confirmZoneButton = page.getByRole('button', { name: /ยืนยันการเลือกโซน/ });
		await expect(confirmZoneButton).toBeEnabled({ timeout: 5_000 });
		await confirmZoneButton.click();

		// Assert — zone-assignment toast fires, and the whole 6-step flow
		// completes, landing on the wristband success screen (same URL, no
		// route change, no re-login required)
		await expect(page.getByText('บันทึกข้อมูลและจัดสรรพื้นที่สำเร็จ')).toBeVisible({
			timeout: 8_000
		});
		await expect(page.getByText('เลือกโซนพักพิงสำเร็จ')).toBeVisible({ timeout: 10_000 });
	});
});
