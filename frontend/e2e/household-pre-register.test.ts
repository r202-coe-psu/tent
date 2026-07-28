/**
 * E2E: Household Pre-registration (5 Steps)
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  Step 1 – ข้อมูลหัวหน้าครัวเรือน (head evacuee info form)                 │
 * │  Step 2 – ข้อมูลที่อยู่ครัวเรือน  (household address form)                  │
 * │  Step 3 – ทรัพย์สินและสัตว์เลี้ยง (pets, assets, vehicles)                  │
 * │  Step 4 – เลือกโซนพักพิง       (zone selection & doc persistence)        │
 * │  Step 5 – จัดการสมาชิก         (household summary & member addition)     │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Testing Best Practices applied (per .agents/skills/testing-bestpractices):
 *  ✅ Arrange-Act-Assert pattern in every test
 *  ✅ Descriptive test names
 *  ✅ afterEach clears session to prevent test pollution
 *  ✅ afterAll deletes temporary CouchDB test user
 *  ✅ Data Validation — Zod schema rules (national ID length, phone length, required fields)
 *  ✅ Security/No-PII — Masked national IDs in summary table; no /api/public calls
 *  ✅ Concurrency — 409 Conflict surfaces a toast error without crashing
 *
 * Run tests:
 *   pnpm playwright test e2e/household-pre-register.test.ts
 */

import { test, expect, type Page } from '@playwright/test';
import { createCouchUser, deleteCouchUser, couchLogin, STAFF_SH001_ROLES } from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { mockCouchRoutes, SHELTER_DB } from './helpers/mock-couch';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

const TEST_USER = {
	name: `pre_reg_hh_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Pre-Reg Staff E2E'
};

const VALID_HEAD_INPUT = {
	nationalId: '1987654321012',
	firstName: 'วิชัย',
	lastName: 'มั่นคง',
	phone: '0812345678',
	emergencyContactName: 'สมใจ มั่นคง',
	emergencyContactPhone: '0898765432'
};

const VALID_ADDRESS_INPUT = {
	addressNo: '99/1',
	villageNo: 'หมู่ 4'
};

test.describe('Household Pre-registration', () => {
	let authSession: string;

	test.beforeAll(async () => {
		await createCouchUser(TEST_USER);
		authSession = await couchLogin(TEST_USER.name, TEST_USER.password);
	});

	test.afterAll(async () => {
		await deleteCouchUser(TEST_USER.name);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
	});

	/** Setup page with mocked CouchDB, master data & injected session. */
	async function setupPage(page: Page) {
		await mockCouchRoutes(page, { withRegistryShelter: true });

		// Mock master data routes for municipality_zone and community
		await page.route('**/api/back-office/master-data/*', async (route) => {
			const type = new URL(route.request().url()).pathname.split('/').pop();
			const items =
				type === 'municipality_zone'
					? [{ code: 'zone_1', label: 'โซน 1' }]
					: type === 'community'
						? [{ code: 'community_1', label: 'ชุมชน 1' }]
						: [];
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ _id: `master_data:${type}`, master_type: type, items })
			});
		});

		await injectSession(page, TEST_USER, authSession);
	}

	/** Helper to fill Step 1: Head Evacuee Info */
	async function fillStep1Head(page: Page, overrides: Partial<typeof VALID_HEAD_INPUT> = {}) {
		const data = { ...VALID_HEAD_INPUT, ...overrides };

		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 15_000
		});

		if (data.nationalId !== undefined) {
			await page.getByPlaceholder('X-XXXX-XXXXX-XX-X').fill(data.nationalId);
		}
		if (data.firstName !== undefined) {
			await page.getByPlaceholder('ชื่อจริง').fill(data.firstName);
		}
		if (data.lastName !== undefined) {
			await page.getByPlaceholder('นามสกุล', { exact: true }).fill(data.lastName);
		}

		// Select Gender
		await page
			.locator('[data-slot="form-item"]')
			.filter({ has: page.locator('label', { hasText: 'เพศ' }) })
			.locator('[data-slot="select-trigger"]')
			.click();
		await page.getByRole('option', { name: /ชาย \(Male\)/ }).click();

		// Fill Phone or Check "ไม่มีเบอร์โทร"
		if (data.phone === null) {
			const noPhoneCheckbox = page
				.locator('label')
				.filter({ hasText: 'ไม่มีเบอร์โทร' })
				.locator('[data-slot="checkbox"]');
			await noPhoneCheckbox.click();
		} else if (data.phone) {
			await page.locator('input[name="phone"]').fill(data.phone);
		}

		// Select Religion
		await page
			.locator('[data-slot="form-item"]')
			.filter({ has: page.locator('label', { hasText: 'ศาสนา' }) })
			.locator('[data-slot="select-trigger"]')
			.click();
		await page.getByRole('option', { name: /พุทธ \(Buddhism\)/ }).click();

		// Fill Emergency Contact
		if (data.emergencyContactName !== undefined) {
			await page.locator('input[name="emergency_contact.name"]').fill(data.emergencyContactName);
		}
		if (data.emergencyContactPhone !== undefined) {
			await page.locator('input[name="emergency_contact.phone"]').fill(data.emergencyContactPhone);
		}
	}

	/** Helper to fill Step 2: Address Info */
	async function fillStep2Address(page: Page, overrides: Partial<typeof VALID_ADDRESS_INPUT> = {}) {
		const data = { ...VALID_ADDRESS_INPUT, ...overrides };

		await expect(
			page.getByRole('heading', { name: 'ที่อยู่ครัวเรือนเดิม (ก่อนอพยพ)' })
		).toBeVisible({ timeout: 10_000 });

		// Select municipality_zone
		await page.getByRole('button', { name: 'เลือกเขตการปกครอง...' }).click();
		await page.getByRole('button', { name: 'โซน 1' }).click();

		// Select community
		await page.getByRole('button', { name: 'เลือกชุมชน...' }).click();
		await page.getByRole('button', { name: 'ชุมชน 1' }).click();

		if (data.addressNo !== undefined) {
			await page.getByPlaceholder('เช่น 12/3').fill(data.addressNo);
		}
		if (data.villageNo !== undefined) {
			await page.getByPlaceholder('เช่น หมู่ 2').fill(data.villageNo);
		}

		// Select Province -> District -> Subdistrict
		await page.getByRole('button', { name: 'เลือกจังหวัด...' }).click();
		await page.getByRole('button', { name: 'สงขลา' }).click();

		await page.getByRole('button', { name: 'เลือกอำเภอ...' }).click();
		await page.getByRole('button', { name: 'หาดใหญ่' }).click();

		await page.getByRole('button', { name: 'เลือกตำบล...' }).click();
		await page.getByRole('button', { name: 'บ้านพรุ' }).click();
	}

	/** Helper to navigate through Step 1 to Step 4 */
	async function goToStep4(page: Page) {
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');

		await fillStep1Head(page);
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();

		await fillStep2Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		// Step 3: Assets & Pets
		await expect(page.getByRole('heading', { name: /ทรัพย์สินและสัตว์เลี้ยง/ })).toBeVisible({
			timeout: 10_000
		});

		const disclaimerCheckbox = page
			.locator('label')
			.filter({ hasText: 'ข้าพเจ้าและครอบครัวรับทราบ' })
			.locator('[data-slot="checkbox"]');
		if (await disclaimerCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
			await disclaimerCheckbox.click();
		}
		await page.getByRole('button', { name: 'ลงทะเบียนสำเร็จ' }).click();

		// Step 4: Zone selection
		await expect(page.getByRole('heading', { name: 'จัดสรรพื้นที่ (Zoning)' })).toBeVisible({
			timeout: 10_000
		});
	}

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 1: UI rendering & Step indicator
	// ══════════════════════════════════════════════════════════════════════════

	test('should render page heading and 5 step labels in indicator', async ({ page }) => {
		// Arrange
		await setupPage(page);

		// Act
		await page.goto('/back-office/households/pre-register');

		// Assert
		await expect(
			page.getByRole('heading', {
				name: /ลงทะเบียนครัวเรือนล่วงหน้า \(Household Pre-registration\)/
			})
		).toBeVisible({ timeout: 15_000 });

		await expect(page.getByText('ข้อมูลหัวหน้าครัวเรือน').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('ข้อมูลที่อยู่ครัวเรือน').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('ทรัพย์สินและสัตว์เลี้ยง').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('เลือกโซนพักพิง').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('จัดการสมาชิก').first()).toBeVisible({ timeout: 5_000 });
	});

	test('should highlight step 1 indicator circle as active initially', async ({ page }) => {
		// Arrange & Act
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 15_000
		});

		// Assert
		const step1Circle = page.locator('div.rounded-full').filter({ hasText: '1' }).first();
		await expect(step1Circle).toHaveClass(/bg-primary/);
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 2: Navigation Flows (Forward & Backward)
	// ══════════════════════════════════════════════════════════════════════════

	test('should advance from step 1 to step 2 upon submitting valid head info', async ({ page }) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');

		// Act
		await fillStep1Head(page);
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();

		// Assert
		await expect(
			page.getByRole('heading', { name: 'ที่อยู่ครัวเรือนเดิม (ก่อนอพยพ)' })
		).toBeVisible({ timeout: 10_000 });
	});

	test('should navigate back from step 2 to step 1 and preserve filled data', async ({ page }) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');
		await fillStep1Head(page, { firstName: 'กิตติ', lastName: 'สุขใจ' });
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();
		await expect(
			page.getByRole('heading', { name: 'ที่อยู่ครัวเรือนเดิม (ก่อนอพยพ)' })
		).toBeVisible({ timeout: 10_000 });

		// Act
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();

		// Assert
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 5_000
		});
		await expect(page.getByPlaceholder('ชื่อจริง')).toHaveValue('กิตติ');
		await expect(page.getByPlaceholder('นามสกุล', { exact: true })).toHaveValue('สุขใจ');
	});

	test('should advance through step 2, step 3, step 4 to step 5 summary page', async ({ page }) => {
		// Arrange & Act
		await goToStep4(page);

		// Click confirm zone on Step 4
		const confirmBtn = page.getByRole('button', { name: /ยืนยันการเลือกโซน/ });
		await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
		await confirmBtn.click();

		// Assert Step 5 Summary Page
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText(/ครอบครัววิชัย มั่นคง/).first()).toBeVisible({ timeout: 5_000 });
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 3: Data Validation (Zod Schemas) & UX Controls
	// ══════════════════════════════════════════════════════════════════════════

	test('should reject step 1 submission when national ID is less than 13 digits', async ({
		page
	}) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');

		// Act — provide 6-digit national ID
		await fillStep1Head(page, { nationalId: '123456' });
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();

		// Assert — field error for 13 digits requirement appears
		await expect(page.locator('[data-fs-field-error]').filter({ hasText: /13 หลัก/ })).toBeVisible({
			timeout: 5_000
		});
	});

	test('should reject step 1 submission when phone number is less than 10 digits', async ({
		page
	}) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');

		// Act — provide 6-digit phone number
		await fillStep1Head(page, { phone: '081234' });
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();

		// Assert — toast error or field error appears
		await expect(page.getByText(/กรุณากรอกเบอร์โทรศัพท์ 10 หลัก|10 หลัก/i).first()).toBeVisible({
			timeout: 5_000
		});
	});

	test('should disable phone input when "ไม่มีเบอร์โทร" checkbox is checked', async ({ page }) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 15_000
		});

		const phoneInput = page.locator('input[name="phone"]');
		await expect(phoneInput).toBeEnabled();

		// Act — click "ไม่มีเบอร์โทร" checkbox
		const noPhoneCheckbox = page
			.locator('label')
			.filter({ hasText: 'ไม่มีเบอร์โทร' })
			.locator('[data-slot="checkbox"]');
		await noPhoneCheckbox.click();

		// Assert — phone input disabled
		await expect(phoneInput).toBeDisabled();

		// Act — uncheck
		await noPhoneCheckbox.click();

		// Assert — phone input re-enabled
		await expect(phoneInput).toBeEnabled();
	});

	test('should reject submission when required fields (first_name, last_name) are empty', async ({
		page
	}) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 15_000
		});

		// Act — fill everything else validly but leave first_name/last_name empty,
		// so the failure is isolated to the required-name check (an all-blank
		// submit would instead fail the national ID length check first).
		await fillStep1Head(page, { firstName: undefined, lastName: undefined });
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();

		// Assert — toast error or field error appears
		await expect(
			page.getByText(/กรุณากรอกข้อมูลให้ถูกต้อง|กรุณากรอกชื่อ|กรุณากรอกนามสกุล/i).first()
		).toBeVisible({ timeout: 5_000 });
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 4: Step 5 Summary, Member Management & Navigation
	// ══════════════════════════════════════════════════════════════════════════

	test('should display head evacuee in summary table with "หัวหน้าครอบครัว" badge', async ({
		page
	}) => {
		// Arrange
		await goToStep4(page);

		// Act — confirm zone selection to advance to Step 5
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();

		// Assert Summary table rendered with head evacuee
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });
		await expect(page.getByText('รายชื่อสมาชิกในบ้าน (1 คน)')).toBeVisible({ timeout: 5_000 });

		const tableRow = page.locator('tr').filter({ hasText: 'วิชัย มั่นคง' });
		await expect(tableRow).toBeVisible({ timeout: 5_000 });
		await expect(tableRow.getByText('หัวหน้าครอบครัว')).toBeVisible({ timeout: 5_000 });
	});

	test('should add a new member to household using inline add member form', async ({ page }) => {
		// Arrange
		await goToStep4(page);
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });

		// Act — click "ลงทะเบียนลูกบ้านเพิ่ม"
		await page.getByRole('button', { name: 'ลงทะเบียนลูกบ้านเพิ่ม' }).click();

		// Assert member form appears
		await expect(
			page.getByRole('heading', { name: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' })
		).toBeVisible({ timeout: 5_000 });

		// Fill member form
		await page
			.locator('form')
			.filter({ hasText: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' })
			.locator('input[placeholder="ชื่อจริง"]')
			.fill('มานี');
		await page
			.locator('form')
			.filter({ hasText: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' })
			.locator('input[placeholder="นามสกุล"]')
			.fill('มั่นคง');

		// Select Member Gender
		await page
			.locator('form')
			.filter({ hasText: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' })
			.locator('[data-slot="form-item"]')
			.filter({ has: page.locator('label', { hasText: 'เพศ' }) })
			.locator('[data-slot="select-trigger"]')
			.click();
		await page.getByRole('option', { name: /หญิง \(Female\)/ }).click();

		// Check "ไม่มีเบอร์โทร" for member
		const memberNoPhoneCheckbox = page
			.locator('form')
			.filter({ hasText: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' })
			.locator('label')
			.filter({ hasText: 'ไม่มีเบอร์โทร' })
			.locator('[data-slot="checkbox"]');
		await memberNoPhoneCheckbox.click();

		// Submit member form
		await page.getByRole('button', { name: 'เพิ่มสมาชิกเข้าร่วมครัวเรือน' }).click();

		// Assert member added & member count updated to 2
		await expect(page.getByText('รายชื่อสมาชิกในบ้าน (2 คน)')).toBeVisible({ timeout: 10_000 });
		const memberRow = page.locator('tr').filter({ hasText: 'มานี มั่นคง' });
		await expect(memberRow).toBeVisible({ timeout: 5_000 });
		await expect(memberRow.getByText('ลูกบ้าน')).toBeVisible({ timeout: 5_000 });
	});

	test('should open QR modal when clicking "ออกและพิมพ์ QR ประจำตัว"', async ({ page }) => {
		// Arrange
		await goToStep4(page);
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });

		// Act — click QR button
		await page.getByRole('button', { name: 'ออกและพิมพ์ QR ประจำตัว' }).click();

		// Assert — modal / dialog visible with QR header or content
		await expect(page.getByText(/วิชัย มั่นคง/).first()).toBeVisible({ timeout: 5_000 });
	});

	test('should navigate to evacuee management household tab when clicking "เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔"', async ({
		page
	}) => {
		// Arrange
		await goToStep4(page);
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });

		// Act
		await page.getByRole('button', { name: 'เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔' }).click();

		// Assert — URL redirected to evacuee management household tab
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 5: Security & Privacy (No-PII Guard)
	// ══════════════════════════════════════════════════════════════════════════

	test('should mask national ID in the step 5 member table (PII guard)', async ({ page }) => {
		// Arrange
		await goToStep4(page);
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();
		await expect(page.getByText('สร้างครัวเรือนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 15_000 });

		// Act & Assert — Full national ID "1987654321012" must NOT appear unmasked in DOM.
		// Instead, the masked format produced by maskNationalId() — first 3 + "***" +
		// last 3 digits, e.g. "198***012" — should be rendered.
		const pageContent = await page.locator('body').innerText();
		expect(pageContent).not.toContain(VALID_HEAD_INPUT.nationalId);
		expect(pageContent).toMatch(/ID:\s*198\*\*\*012/);
	});

	test('should not make calls to public API endpoints during pre-registration (PII guard)', async ({
		page
	}) => {
		// Arrange — intercept any calls to public API routes
		const publicRequests: string[] = [];
		await setupPage(page);

		await page.route('/api/public/**', async (route) => {
			publicRequests.push(route.request().url());
			await route.continue();
		});

		// Act — perform registration up to Step 3
		await page.goto('/back-office/households/pre-register');
		await fillStep1Head(page);
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();
		await fillStep2Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		// Assert — zero requests to public APIs
		expect(publicRequests).toHaveLength(0);
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 6: Concurrency & 409 Conflict Handling
	// ══════════════════════════════════════════════════════════════════════════

	test('should surface a toast error when CouchDB returns 409 Conflict on household creation', async ({
		page
	}) => {
		// Arrange — setup page and intercept PUT requests to shelter DB to return 409 Conflict
		await setupPage(page);

		await page.route(`**/${SHELTER_DB}/**`, async (route) => {
			const req = route.request();
			const last = new URL(req.url()).pathname.split('/').filter(Boolean).at(-1) ?? '';
			if (last.startsWith('_')) {
				await route.fallback();
				return;
			}
			if (req.method() === 'PUT') {
				await route.fulfill({
					status: 409,
					contentType: 'application/json',
					body: JSON.stringify({ error: 'conflict', reason: 'Document update conflict.' })
				});
				return;
			}
			await route.fallback();
		});

		// Navigate to step 4
		await page.goto('/back-office/households/pre-register');
		await fillStep1Head(page);
		await page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ }).click();
		await fillStep2Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();
		await expect(page.getByRole('heading', { name: /ทรัพย์สินและสัตว์เลี้ยง/ })).toBeVisible({
			timeout: 10_000
		});

		const disclaimerCheckbox = page
			.locator('label')
			.filter({ hasText: 'ข้าพเจ้าและครอบครัวรับทราบ' })
			.locator('[data-slot="checkbox"]');
		if (await disclaimerCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
			await disclaimerCheckbox.click();
		}
		await page.getByRole('button', { name: 'ลงทะเบียนสำเร็จ' }).click();

		await expect(page.getByRole('heading', { name: 'จัดสรรพื้นที่ (Zoning)' })).toBeVisible({
			timeout: 10_000
		});

		// Act — submit zone selection (triggers evacuee/household PUT)
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();

		// Assert — Toast error displayed surfacing the conflict/error message
		await expect(page.getByText(/เกิดข้อผิดพลาด/i)).toBeVisible({ timeout: 8_000 });
	});

	// ══════════════════════════════════════════════════════════════════════════
	// SECTION 7: Accessibility Smoke Checks
	// ══════════════════════════════════════════════════════════════════════════

	test('should allow form inputs and submit button on step 1 to receive keyboard focus', async ({
		page
	}) => {
		// Arrange
		await setupPage(page);
		await page.goto('/back-office/households/pre-register');
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
			timeout: 15_000
		});

		// Act & Assert
		const firstNameInput = page.getByPlaceholder('ชื่อจริง');
		await firstNameInput.focus();
		await expect(firstNameInput).toBeFocused();

		const nextBtn = page.getByRole('button', { name: /ถัดไป \(ข้อมูลที่อยู่ครัวเรือน\) →/ });
		await nextBtn.focus();
		await expect(nextBtn).toBeFocused();
	});
});
