/**
 * E2E: Phase 2 intake pipeline (#252)
 *
 * Confirmed Playwright seams (Playwright-only — no new Vitest):
 * 1. Staff Station 1 → Unified Registration → batch QR → Medical Screening → Zoning
 * 2. Public Unassigned Registration → staff Claim → Report-in
 * 3. enable_medical_screening OFF → Station 1 skips Station 2
 * 4. Anti-duplicate — existing Evacuee blocks new create
 *
 * Run (rebuild first — matches package.json test:e2e):
 *   pnpm exec vite build --mode test && pnpm playwright test e2e/intake-pipeline.test.ts
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	STAFF_SH001_ROLES,
	SM_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { mockCouchRoutes, SHELTER_DB } from './helpers/mock-couch';

const RUN_ID = Date.now().toString(36);

const STAFF = {
	name: `intake_staff_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Intake Staff E2E'
};

const MANAGER = {
	name: `intake_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Intake Manager E2E'
};

const INTAKE_SEARCH_PLACEHOLDER =
	'เลขบัตรประชาชน / หนังสือเดินทาง / ชื่อ-นามสกุล / เบอร์โทร';

const EXISTING_EVACUEE = {
	_id: 'evacuee:01INTAKEANTI000000000001',
	_rev: '1-mock',
	type: 'evacuee',
	schema_v: 10,
	first_name: 'สมศักดิ์',
	last_name: 'มีอยู่แล้ว',
	gender: 'male',
	phone: '0811111111',
	person_id: { cardType: 'national_id', number: '1234567890123' },
	current_stay: { status: 'arriving', zone: null, since: '2026-09-09T00:00:00.000Z' },
	privacy: { search_excluded: false },
	shelter_code: 'SH001'
};

const UNASSIGNED_HIT = {
	id: '01JUNASSIGNEDCLAIM00000001',
	reserved_household_id: 'household:01JUNASSIGNEDHH0000001',
	registered_via: 'web' as const,
	status: 'open',
	created_at: '2026-09-09T03:00:00.000Z',
	open_members: [
		{
			reserved_evacuee_id: 'evacuee:01JUNASSIGNEDM1',
			status: 'open' as const,
			first_name: 'คิวกลาง',
			last_name: 'หนึ่ง',
			gender: 'female',
			phone: '0822222222',
			person_id: { cardType: 'national_id' as const, number: '9876543210987' },
			country: 'THAILAND',
			vulnerable_groups: [] as string[],
			special_needs: [] as string[]
		},
		{
			reserved_evacuee_id: 'evacuee:01JUNASSIGNEDM2',
			status: 'open' as const,
			first_name: 'คิวกลาง',
			last_name: 'สอง',
			gender: 'male',
			phone: null,
			person_id: { cardType: 'anonymous' as const, number: 'ANON-E2E-2' },
			country: 'THAILAND',
			vulnerable_groups: [] as string[],
			special_needs: [] as string[]
		}
	]
};

async function mockUnassignedSearch(page: Page, results: unknown[] = []) {
	await page.route('**/api/staff/v1/unassigned-registrations/search**', async (route) => {
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ results })
		});
	});
}

async function mockUnassignedClaim(page: Page) {
	await page.route('**/api/staff/v1/unassigned-registrations/*/claim', async (route) => {
		if (route.request().method() !== 'POST') return route.continue();
		const body = route.request().postDataJSON() as { member_ids?: string[] };
		const claimedIds = body.member_ids ?? [];
		const claimed = UNASSIGNED_HIT.open_members
			.filter((m) => claimedIds.includes(m.reserved_evacuee_id))
			.map((m) => ({
				reserved_evacuee_id: m.reserved_evacuee_id,
				status: 'claimed' as const,
				first_name: m.first_name,
				last_name: m.last_name
			}));
		const remaining = UNASSIGNED_HIT.open_members.filter(
			(m) => !claimedIds.includes(m.reserved_evacuee_id)
		);
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({
				success: true,
				id: remaining.length ? UNASSIGNED_HIT.id : null,
				deleted: remaining.length === 0,
				shelter_code: 'SH001',
				household_id: UNASSIGNED_HIT.reserved_household_id,
				evacuee_ids: claimedIds,
				claimed,
				remaining_open: remaining
			})
		});
	});
}

async function setupPage(
	page: Page,
	user: typeof STAFF,
	authSession: string,
	opts: {
		enableMedicalScreening?: boolean;
		seedDocs?: Record<string, unknown>[];
		unassignedResults?: unknown[];
	} = {}
) {
	await mockCouchRoutes(page, {
		withRegistryShelter: true,
		enableMedicalScreening: opts.enableMedicalScreening ?? false,
		seedDocs: opts.seedDocs ?? []
	});
	await mockUnassignedSearch(page, opts.unassignedResults ?? []);
	await injectSession(page, user, authSession);
}

/** Minimal Unified Registration: homeless + landmark + anonymous primary contact. */
async function fillMinimalUnifiedRegistration(
	page: Page,
	opts: { firstName: string; lastName: string; addSecondMember?: boolean; customPet?: boolean }
) {
	await page.locator('#housing-type').click();
	await page.getByRole('option', { name: /ไร้ที่อยู่อาศัย/ }).click();
	await page.locator('#residence-landmark').fill('ริมคลอง E2E');

	if (opts.customPet) {
		await page.getByRole('button', { name: 'สัตว์อื่นๆ', exact: true }).click();
		await page.getByPlaceholder('เช่น นกแก้ว, กระต่าย, ชูก้าไรเดอร์').fill('นกเขา');
	}

	const primary = page.getByRole('region', { name: 'ผู้ติดต่อหลัก' });
	await primary.getByRole('button', { name: 'ไม่มีบัตร / บุคคลนิรนาม' }).click();
	await primary.locator('#member-0-first-name').fill(opts.firstName);
	await primary.locator('#member-0-last-name').fill(opts.lastName);
	// Gender radios required (blankUnifiedMember no longer defaults gender).
	await primary.locator('#member-0-gender-male').click({ force: true });

	if (opts.addSecondMember) {
		await page.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		const member2 = page.getByRole('region', { name: 'สมาชิก 2' });
		await expect(member2).toBeVisible();
		await member2.getByRole('button', { name: 'ไม่มีบัตร / บุคคลนิรนาม' }).click();
		await member2.locator('#member-1-first-name').fill('สมาชิก');
		await member2.locator('#member-1-last-name').fill('คนที่สอง');
		await member2.locator('#member-1-gender-female').click({ force: true });
	}
}

test.describe('Phase 2 intake pipeline (#252)', () => {
	let staffSession: string;
	let managerSession: string;

	test.beforeAll(async () => {
		await createCouchUser(STAFF);
		await createCouchUser(MANAGER);
		staffSession = await couchLogin(STAFF.name, STAFF.password);
		managerSession = await couchLogin(MANAGER.name, MANAGER.password);
	});

	test.afterAll(async () => {
		await deleteCouchUser(STAFF.name);
		await deleteCouchUser(MANAGER.name);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
	});

	// ── Seam 1 first slice: search not-found → Unified Registration ───────────

	test('Station 1 search not-found shows new-registration CTA and opens Unified Registration Form', async ({
		page
	}) => {
		await setupPage(page, STAFF, staffSession);
		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText('Station 1')).toBeVisible();

		const search = page.getByLabel(INTAKE_SEARCH_PLACEHOLDER);
		await search.fill('สมชายไม่มีในระบบ');
		await expect(page.getByText('ไม่พบรายการ')).toBeVisible({ timeout: 10_000 });

		await page.getByRole('link', { name: '+ ลงทะเบียนใหม่' }).click();

		await expect(page).toHaveURL(/\/onsite\/people\/new/);
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible({
			timeout: 10_000
		});
		await expect(
			page.getByRole('heading', { name: /ข้อมูลครอบครัวร่วม|ข้อมูลที่อยู่อาศัย/ })
		).toBeVisible();
		await expect(page.getByRole('textbox', { name: /ชื่อ/ }).first()).toBeVisible();
	});

	// ── Seam 4: anti-duplicate ────────────────────────────────────────────────

	test('Station 1 search of existing Evacuee shows status and locks prominent new-registration CTA', async ({
		page
	}) => {
		await setupPage(page, STAFF, staffSession, { seedDocs: [EXISTING_EVACUEE] });
		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});

		await page.getByLabel(INTAKE_SEARCH_PLACEHOLDER).fill('สมศักดิ์');
		await expect(page.getByRole('heading', { name: 'ในศูนย์นี้' })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByText('สมศักดิ์ มีอยู่แล้ว')).toBeVisible();
		await expect(page.getByText(/อยู่ระหว่างรอเข้าพัก|สถานะ:/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'ดูสถานะ' })).toBeVisible();

		// Prominent not-found CTA must not appear while federated hits lock new-reg
		await expect(page.getByRole('heading', { name: 'ไม่พบรายการ' })).toHaveCount(0);
		await expect(page.getByRole('link', { name: '+ ลงทะเบียนใหม่' })).toHaveCount(0);
		await expect(page.getByText(/พบรายการที่ตรงกัน/)).toBeVisible();
	});

	// ── Seam 3: medical screening OFF skips Station 2 queue chip ──────────────

	test('when enable_medical_screening is OFF Station 1 hides รอแพทย์ chip', async ({ page }) => {
		await setupPage(page, MANAGER, managerSession, {
			enableMedicalScreening: false,
			seedDocs: [EXISTING_EVACUEE]
		});
		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});

		await expect(page.getByRole('button', { name: 'รอโซน' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'รอแพทย์', exact: true })).toHaveCount(0);
	});

	test('when enable_medical_screening is ON Station 1 shows รอแพทย์ chip', async ({ page }) => {
		await setupPage(page, MANAGER, managerSession, {
			enableMedicalScreening: true,
			seedDocs: [EXISTING_EVACUEE]
		});
		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});

		await expect(page.getByRole('button', { name: 'รอแพทย์', exact: true })).toBeVisible();
		await expect(page.getByRole('button', { name: 'รอโซน' })).toBeVisible();
	});

	// ── Seam 1 continued: walk-in → batch QR ──────────────────────────────────

	test('walk-in Unified Registration with homeless address and multi-member reaches FamilyBatchPrint', async ({
		page
	}) => {
		await setupPage(page, STAFF, staffSession);
		await page.goto('/onsite/people/new');
		await expect(page.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible({
			timeout: 15_000
		});

		await fillMinimalUnifiedRegistration(page, {
			firstName: 'วอล์คอิน',
			lastName: 'ครอบครัว',
			addSecondMember: true,
			customPet: true
		});

		await page.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).click();

		await expect(page.getByRole('heading', { name: 'พิมพ์บัตรประจำตัวครอบครัว' })).toBeVisible({
			timeout: 20_000
		});
		await expect(page.getByText(/· 2 คน/)).toBeVisible();
	});

	// ── Seam 2: Unassigned Registration claim → Report-in ─────────────────────

	test('Station 1 Unassigned Registration partial claim navigates to Report-in', async ({
		page
	}) => {
		await setupPage(page, STAFF, staffSession, { unassignedResults: [UNASSIGNED_HIT] });
		await mockUnassignedClaim(page);

		// Seed Couch birth target so Report-in page can load the Evacuee
		await page.route(`**/${SHELTER_DB}/evacuee:01JUNASSIGNEDM1`, async (route) => {
			if (route.request().method() === 'GET') {
				await route.fulfill({
					status: 200,
					contentType: 'application/json',
					body: JSON.stringify({
						_id: 'evacuee:01JUNASSIGNEDM1',
						_rev: '1-mock',
						type: 'evacuee',
						schema_v: 10,
						first_name: 'คิวกลาง',
						last_name: 'หนึ่ง',
						gender: 'female',
						phone: '0822222222',
						person_id: { cardType: 'national_id', number: '9876543210987' },
						current_stay: {
							status: 'pre_registered',
							zone: null,
							since: '2026-09-09T04:00:00.000Z'
						},
						privacy: { search_excluded: false },
						shelter_code: 'SH001',
						household_id: UNASSIGNED_HIT.reserved_household_id
					})
				});
				return;
			}
			await route.fallback();
		});

		await page.goto('/onsite/people');
		await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
			timeout: 15_000
		});

		await page.getByLabel(INTAKE_SEARCH_PLACEHOLDER).fill('คิวกลาง');
		await expect(page.getByText('คิวกลาง')).toBeVisible({ timeout: 10_000 });
		await expect(page.getByText(UNASSIGNED_HIT.id)).toBeVisible();

		await page.getByRole('button', { name: 'รับเข้าศูนย์' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByText('รับเข้าศูนย์ (claim)')).toBeVisible();

		// Partial claim — tick only the first open member
		await dialog.getByLabel('เลือก คิวกลาง หนึ่ง').click();
		await dialog.getByRole('button', { name: 'ยืนยันรับเข้าศูนย์' }).click();

		await expect(page).toHaveURL(/\/onsite\/people\/evacuee:01JUNASSIGNEDM1\/report-in/, {
			timeout: 15_000
		});
		await expect(page.getByRole('heading', { name: 'รายงานตัว' })).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByText(/Station 1 · Report-in/)).toBeVisible();
	});

	// ── Seam 1 / 3: Medical Screening simplified form reachable when flag ON ─

	test('Station 2 simplified Medical Screening form has no triage or vitals when flag ON', async ({
		page
	}) => {
		await setupPage(page, MANAGER, managerSession, {
			enableMedicalScreening: true,
			seedDocs: [EXISTING_EVACUEE]
		});

		await page.goto(`/onsite/medical-screening/${EXISTING_EVACUEE._id}`);
		await expect(page.getByText(/คัดกรอง|Medical/i).first()).toBeVisible({ timeout: 15_000 });

		// CR-106 simplified form — care track + EWAR, no triage/vitals fields
		await expect(page.getByText(/ดูแลตามปกติ|Normal|Fast track/i).first()).toBeVisible({
			timeout: 10_000
		});
		await expect(page.getByRole('button', { name: 'บันทึกผลคัดกรอง' })).toBeVisible();
		await expect(page.getByText(/อุณหภูมิ|blood group|triage level|ระดับไทรอาจ/i)).toHaveCount(0);
	});

	// ── Seam 1 / 3: Zoning reachable when medical flag OFF (skip Station 2) ───

	test('when medical screening is OFF Zoning page accepts arriving Evacuee without screening', async ({
		page
	}) => {
		await setupPage(page, MANAGER, managerSession, {
			enableMedicalScreening: false,
			seedDocs: [EXISTING_EVACUEE]
		});

		await page.goto('/onsite/zoning');
		await expect(page.getByText(/จัดโซน|Zoning|พร้อมจัดโซน/i).first()).toBeVisible({
			timeout: 15_000
		});
		await expect(page.getByText('สมศักดิ์ มีอยู่แล้ว')).toBeVisible({ timeout: 10_000 });
		await expect(
			page.getByText(/ต้องผ่านคัดกรองแพทย์ก่อน/)
		).toHaveCount(0);
	});
});
