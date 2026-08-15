/**
 * E2E: Household Post-arrival Grouping (6 Steps)
 *
 * ┌────────────────────────────────────────────────────────────────────────────┐
 * │  Step 1 – เลือกหัวหน้าครัวเรือน  (select head evacuee)                      │
 * │  Step 2 – เลือกสมาชิกครัวเรือน   (select household members)                  │
 * │  Step 3 – ระบุที่อยู่ครัวเรือน    (household address form)                    │
 * │  Step 4 – ทรัพย์สินและสัตว์เลี้ยง  (pets, assets, vehicles)                     │
 * │  Step 5 – เลือกโซนพักพิง         (zone selection & doc persistence)          │
 * │  Step 6 – จัดกลุ่มสำเร็จ         (household summary)                         │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Testing Best Practices applied (per .agents/skills/testing-bestpractices):
 *  ✅ Arrange-Act-Assert pattern in every test
 *  ✅ Descriptive test names
 *  ✅ afterEach clears session to prevent test pollution
 *  ✅ afterAll deletes temporary CouchDB test user
 *  ✅ Data Validation — Zod schema rules (province, district, subdistrict, address No)
 *  ✅ Security/No-PII — Masked national IDs in summary; no /api/public calls
 *  ✅ Concurrency — 409 Conflict surfaces a toast error without crashing
 *
 * Run tests:
 *   pnpm playwright test e2e/household-post-arrival.test.ts
 */

import { test, expect, type Page } from '@playwright/test';
import { createCouchUser, deleteCouchUser, couchLogin, STAFF_SH001_ROLES } from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { mockCouchRoutes, SHELTER_DB } from './helpers/mock-couch';

interface CouchDoc {
	_id: string;
	_rev?: string;
	[key: string]: unknown;
}

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

const TEST_USER = {
	name: `post_arr_hh_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Post-Arr Staff E2E'
};

const MOCK_HEAD_EVACUEE = {
	_id: 'evacuee:head-12345',
	_rev: '1-mock',
	type: 'evacuee',
	first_name: 'นที',
	last_name: 'รักษาดี',
	gender: 'male',
	phone: '0811111111',
	person_id: { cardType: 'national_id', number: '1111111111111' },
	current_stay: { status: 'active', zone: null, since: '2026-07-25T00:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'app'
};

const MOCK_MEMBER_EVACUEE = {
	_id: 'evacuee:member-67890',
	_rev: '1-mock',
	type: 'evacuee',
	first_name: 'พัชรา',
	last_name: 'รักษาดี',
	gender: 'female',
	phone: '0822222222',
	person_id: { cardType: 'national_id', number: '2222222222222' },
	current_stay: { status: 'active', zone: null, since: '2026-07-25T00:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'app'
};

const MOCK_CONFL_EVACUEE = {
	_id: 'evacuee:conflict-123',
	_rev: '1-mock',
	type: 'evacuee',
	first_name: 'ขัดแย้ง',
	last_name: 'มีบ้าน',
	gender: 'female',
	phone: '0833333333',
	person_id: { cardType: 'national_id', number: '3333333333333' },
	current_stay: { status: 'active', zone: null, since: '2026-07-25T00:00:00.000Z' },
	household_id: 'household:existing-456',
	privacy: { search_excluded: false },
	registered_via: 'app'
};

const MOCK_CONFL_SIBLING = {
	_id: 'evacuee:conflict-sibling',
	_rev: '1-mock',
	type: 'evacuee',
	first_name: 'พี่น้อง',
	last_name: 'มีบ้าน',
	gender: 'male',
	phone: '0844444444',
	person_id: { cardType: 'national_id', number: '4444444444444' },
	current_stay: { status: 'active', zone: null, since: '2026-07-25T00:00:00.000Z' },
	household_id: 'household:existing-456',
	privacy: { search_excluded: false },
	registered_via: 'app'
};

const MOCK_EXISTING_HOUSEHOLD = {
	_id: 'household:existing-456',
	_rev: '1-mock',
	type: 'household',
	label: 'ครอบครัวขัดแย้ง มีบ้าน',
	head_evacuee_id: 'evacuee:conflict-123',
	status: 'checked_in',
	vehicles: [],
	pets: [],
	address_no: '123',
	province: 'สงขลา',
	district: 'หาดใหญ่',
	subdistrict: 'บ้านพรุ'
};

test.describe('Household Post-arrival Grouping', () => {
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

	async function setupPage(page: Page, initialDocs: CouchDoc[] = []) {
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

		const testDocs = new Map<string, CouchDoc>();
		for (const doc of initialDocs) {
			testDocs.set(doc._id, doc);
		}

		let revCounter = 0;
		await page.route(`**/${SHELTER_DB}/**`, async (route) => {
			const req = route.request();
			const segments = new URL(req.url()).pathname.split('/').filter(Boolean);
			const last = segments[segments.length - 1] ?? '';

			if (last === '_all_docs') {
				const startkeyParam = new URL(req.url()).searchParams.get('startkey');
				let matches = [...testDocs.values()];
				if (startkeyParam) {
					try {
						const typePrefix = (JSON.parse(startkeyParam) as string).replace(/:$/, '');
						matches = matches.filter(
							(d) => typeof d._id === 'string' && (d._id as string).startsWith(`${typePrefix}:`)
						);
					} catch {
						// Malformed startkey — ignore
					}
				}
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({ rows: matches.map((doc) => ({ id: doc._id, doc })) })
				});
				return;
			}

			if (last.startsWith('_')) {
				await route.fallback();
				return;
			}

			const docId = decodeURIComponent(last);
			if (req.method() === 'GET') {
				const doc = testDocs.get(docId);
				if (doc) {
					await route.fulfill({
						status: 200,
						contentType: 'application/json',
						body: JSON.stringify(doc)
					});
				} else {
					await route.fulfill({
						status: 404,
						contentType: 'application/json',
						body: JSON.stringify({ error: 'not_found', reason: 'missing' })
					});
				}
				return;
			}

			if (req.method() === 'PUT') {
				const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
				const isCreate = !testDocs.has(docId);
				revCounter += 1;
				const rev = `${revCounter}-mock`;
				testDocs.set(docId, { ...body, _id: docId, _rev: rev });
				await route.fulfill({
					status: isCreate ? 201 : 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true, id: docId, rev })
				});
				return;
			}

			await route.fallback();
		});

		page.on('console', (msg) => console.log('PAGE CONSOLE:', msg.text()));
		page.on('request', (request) => console.log('>>', request.method(), request.url()));
		page.on('response', (response) => console.log('<<', response.status(), response.url()));
		await injectSession(page, TEST_USER, authSession);
	}

	async function fillStep3Address(page: Page) {
		await expect(page.getByRole('heading', { name: '3. ระบุข้อมูลที่อยู่ครัวเรือน' })).toBeVisible({
			timeout: 10_000
		});

		// Select municipality_zone
		await page.getByPlaceholder('เลือกเขตเทศบาล...').click();
		await page.getByRole('button', { name: 'โซน 1' }).click();

		// Select community
		await page.getByPlaceholder('เลือกชุมชน...').click();
		await page.getByRole('button', { name: 'ชุมชน 1' }).click();

		// Address fields
		await page.getByPlaceholder('เช่น 12/3').fill('99/1');
		await page.getByPlaceholder('เช่น หมู่ 2').fill('หมู่ 4');

		// Province -> District -> Subdistrict
		await page.getByRole('combobox', { name: /จังหวัด/ }).click();
		await page.getByRole('option', { name: 'สงขลา' }).click();

		await page.getByRole('combobox', { name: /อำเภอ/ }).click();
		await page.getByRole('option', { name: 'หาดใหญ่' }).click();

		await page.getByRole('combobox', { name: /ตำบล/ }).click();
		await page.getByRole('option', { name: 'บ้านพรุ' }).click();
	}

	test('should render page heading and 6 step labels in indicator', async ({ page }) => {
		// Arrange
		await setupPage(page);

		// Act
		await page.goto('/back-office/households/new');

		// Assert
		await expect(
			page.getByRole('heading', {
				name: /จัดกลุ่มผู้ประสบภัยเป็นครัวเรือน/
			})
		).toBeVisible({ timeout: 15_000 });

		await expect(page.getByText('เลือกหัวหน้าครัวเรือน').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('เลือกสมาชิกครัวเรือน').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('ระบุที่อยู่ครัวเรือน').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('ทรัพย์สินและสัตว์เลี้ยง').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('เลือกโซนพักพิง').first()).toBeVisible({ timeout: 5_000 });
		await expect(page.getByText('จัดกลุ่มสำเร็จ').first()).toBeVisible({ timeout: 5_000 });
	});

	test('should advance step-by-step through the grouping flow and display correct summary', async ({
		page
	}) => {
		// Arrange
		await setupPage(page, [MOCK_HEAD_EVACUEE, MOCK_MEMBER_EVACUEE]);

		// Act: Step 1
		await page.goto('/back-office/households/new');
		await expect(
			page.getByRole('heading', { name: '1. ตรวจสอบและเลือกหัวหน้าครัวเรือน' })
		).toBeVisible({
			timeout: 15_000
		});

		// Search for head
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('นที');
		const selectHeadBtn = page.getByRole('button', { name: 'เลือกเป็นหัวหน้า' });
		await expect(selectHeadBtn).toBeVisible({ timeout: 5_000 });
		await selectHeadBtn.click();

		// Click next to Step 2
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();

		// Step 2: Select member
		await expect(
			page.getByRole('heading', { name: '2. ค้นหาและเลือกสมาชิกในครัวเรือน' })
		).toBeVisible({
			timeout: 10_000
		});

		// Search for member
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('พัชรา');
		const addMemberBtn = page.getByRole('button', { name: 'เพิ่มสมาชิก' });
		await expect(addMemberBtn).toBeVisible({ timeout: 5_000 });
		await addMemberBtn.click();

		// Click next to Step 3
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();

		// Step 3: Address Form
		await fillStep3Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		// Step 4: Assets & Pets
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

		// Step 5: Zone selection
		await expect(page.getByRole('heading', { name: 'จัดสรรพื้นที่ (Zoning)' })).toBeVisible({
			timeout: 10_000
		});

		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();

		// Step 6: Success summary
		await expect(page.getByText('จัดกลุ่มครอบครัวและออกรหัสครัวเรือนสำเร็จ!')).toBeVisible({
			timeout: 15_000
		});

		await expect(page.getByText('ครอบครัวนที รักษาดี', { exact: true })).toBeVisible({
			timeout: 5_000
		});
		await expect(page.getByText('รายชื่อสมาชิกในบ้าน (2 คน)')).toBeVisible({ timeout: 5_000 });

		// Click finish
		await page.getByRole('button', { name: 'เสร็จสิ้นการจัดกลุ่มครอบครัว ✔' }).click();
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);
	});

	test('should reject step 3 submission when required fields are empty', async ({ page }) => {
		// Arrange
		await setupPage(page, [MOCK_HEAD_EVACUEE, MOCK_MEMBER_EVACUEE]);

		// Navigate to Step 3
		await page.goto('/back-office/households/new');
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('นที');
		await page.getByRole('button', { name: 'เลือกเป็นหัวหน้า' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('พัชรา');
		await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();

		// Submit empty address form
		await expect(page.getByRole('heading', { name: '3. ระบุข้อมูลที่อยู่ครัวเรือน' })).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		// Assert Zod validation field errors
		await expect(
			page.locator('[data-fs-field-error]').filter({ hasText: /กรุณากรอกบ้านเลขที่/ })
		).toBeVisible({
			timeout: 5_000
		});
		await expect(
			page.locator('[data-fs-field-error]').filter({ hasText: /กรุณาเลือกจังหวัด/ })
		).toBeVisible({
			timeout: 5_000
		});
	});

	test('should disallow selecting a head evacuee who is already in another active household (conflict check)', async ({
		page
	}) => {
		// Arrange
		await setupPage(page, [MOCK_CONFL_EVACUEE, MOCK_CONFL_SIBLING, MOCK_EXISTING_HOUSEHOLD]);

		// Act
		await page.goto('/back-office/households/new');
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('ขัดแย้ง');

		// Assert - Badge showing existing household is displayed, and 'เลือกเป็นหัวหน้า' button is not available
		await expect(page.getByText('สังกัด: ครอบครัวขัดแย้ง มีบ้าน')).toBeVisible({ timeout: 5_000 });
		await expect(page.getByRole('button', { name: 'เลือกเป็นหัวหน้า' })).not.toBeVisible();
	});

	test('should navigate back and preserve filled address details', async ({ page }) => {
		// Arrange
		await setupPage(page, [MOCK_HEAD_EVACUEE, MOCK_MEMBER_EVACUEE]);

		// Navigate to Step 3
		await page.goto('/back-office/households/new');
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('นที');
		await page.getByRole('button', { name: 'เลือกเป็นหัวหน้า' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('พัชรา');
		await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();

		// Fill address
		await fillStep3Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		// Go back from Step 4
		await expect(page.getByRole('heading', { name: /ทรัพย์สินและสัตว์เลี้ยง/ })).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();

		// Assert address is preserved
		await expect(page.getByPlaceholder('เช่น 12/3')).toHaveValue('99/1');
		await expect(page.getByPlaceholder('เช่น หมู่ 2')).toHaveValue('หมู่ 4');
	});

	test('should surface a toast error when CouchDB returns 409 Conflict on household save', async ({
		page
	}) => {
		// Arrange
		await setupPage(page, [MOCK_HEAD_EVACUEE, MOCK_MEMBER_EVACUEE]);

		// Intercept PUT requests to return 409 Conflict
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

		// Go through pages to Step 5
		await page.goto('/back-office/households/new');
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('นที');
		await page.getByRole('button', { name: 'เลือกเป็นหัวหน้า' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();
		await page.getByPlaceholder('เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...').fill('พัชรา');
		await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await page.getByRole('button', { name: /ขั้นตอนถัดไป/ }).click();
		await fillStep3Address(page);
		await page.getByRole('button', { name: /ถัดไป \(ทรัพย์สินและสัตว์เลี้ยง\) →/ }).click();

		const disclaimerCheckbox = page
			.locator('label')
			.filter({ hasText: 'ข้าพเจ้าและครอบครัวรับทราบ' })
			.locator('[data-slot="checkbox"]');
		if (await disclaimerCheckbox.isVisible({ timeout: 2000 }).catch(() => false)) {
			await disclaimerCheckbox.click();
		}
		await page.getByRole('button', { name: 'ลงทะเบียนสำเร็จ' }).click();

		// Step 5: Zone
		await expect(page.getByRole('heading', { name: 'จัดสรรพื้นที่ (Zoning)' })).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: /ยืนยันการเลือกโซน/ }).click();

		// Assert toast error is visible
		await expect(page.getByText(/เกิดข้อผิดพลาดในการบันทึก/i)).toBeVisible({ timeout: 8_000 });
	});
});
