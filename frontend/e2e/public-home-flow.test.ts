/**
 * Public landing page (/) — true end-to-end, no seeding and no mocks (except the
 * thin error-contract routes in the smoke group).
 *
 * Local target: the critical group does what staff do — create a shelter in system
 * management and post a critical "Special Request" on the back-office donation board —
 * and afterAll tears the shelter down through the CouchDB admin API (the worker
 * cascades that to its public needs; the UI cannot delete shelters).
 * Remote target (`E2E_BASE_URL`, staging/production): read-only — setup, teardown and
 * the urgent-need card test are skipped. There is deliberately no production need
 * fixture: a test "critical need" on the live landing page would invite real
 * donations. Navigation, hero search, volunteer and language checks still run.
 *
 * ── Tags ──────────────────────────────────────────────────────────────────────────
 *  @public    feature tag
 *  @smoke     read-only journey / render / error (safe on staging/prod)
 *  @critical  local writes (shelter + need) + urgent-need assert; skipped when IS_REMOTE
 *  @release   thin release-gate journey (landing shell + nav + hero search)
 *  @prod      compact production smoke subset of @release
 *
 * Local requirements: the full local stack: `docker compose up -d` (CouchDB, MongoDB, sync worker,
 * FastAPI :9000) plus platform init (`pnpm seed:master` for the catalog, `pnpm db:sync`).
 * Locators are generated with Playwright codegen (`pnpm exec playwright codegen`).
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession } from './helpers/couch';
import { IS_REMOTE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { teardownShelter } from './helpers/public-cleanup';
import {
	createCriticalNeedViaUi,
	createShelterViaUi,
	selectActiveShelter
} from './helpers/staff-ui';

const SHELTER_NAME = `E2E ศูนย์ทดสอบหน้าแรก ${RUN_ID}`;
const NEED_ITEM = 'น้ำดื่ม 600 มล.';

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) await teardownShelter(shelterCode);
});

test.describe('Public landing: setup and urgent need', { tag: ['@public', '@critical'] }, () => {
	test.describe.configure({ mode: 'serial' });

	test('staff creates a shelter and posts a critical donation need', async ({ page }) => {
		test.skip(IS_REMOTE, READ_ONLY_REASON);
		test.setTimeout(120_000);
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);

		shelterCode = await createShelterViaUi(page, {
			name: SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.0,
			lng: 100.48,
			subdistrict: 'คอหงส์',
			capacity: 80
		});
		await selectActiveShelter(page, shelterCode);
		await createCriticalNeedViaUi(page, {
			item: NEED_ITEM,
			quantity: 500,
			reason: `E2E ต้องการน้ำดื่มด่วน ${RUN_ID}`
		});
	});

	test('lists the critical need and links to its donation form', async ({ page }) => {
		test.skip(IS_REMOTE, 'no production need fixture — it would invite real donations');
		test.setTimeout(45_000); // outlasts the 35 s projection wait below
		// This shelter was just created — the worker's registry listener only polls for
		// brand-new shelter databases every 30s (listeners/registry.py), so this first
		// wait needs headroom past that; retry the landing page until it does.
		await expect(async () => {
			await page.goto('/');
			await expect(page.getByRole('heading', { name: SHELTER_NAME })).toBeVisible({
				timeout: 3_000
			});
		}).toPass({ intervals: [2_000], timeout: 35_000 });

		await expect(page.getByRole('heading', { name: 'รับบริจาคด่วน', exact: true })).toBeVisible();
		await expect(page.getByText(NEED_ITEM)).toBeVisible();
		await expect(page.getByText('ขาดอีก 500 จากเป้า 500')).toBeVisible();

		// Scope to THIS run's shelter: a seeded DB has its own urgent needs, so the bare
		// "แจ้งบริจาค" link name matches several cards (strict-mode violation).
		const donateLink = page.locator(`a[href="/donations?shelter=${shelterCode}"]`);
		await expect(donateLink).toHaveText('แจ้งบริจาค');
		await donateLink.click();
		await expect(page).toHaveURL(new RegExp(`/donations\\?shelter=${shelterCode}$`));
	});
});

test.describe(
	'Public landing: render and journey',
	{ tag: ['@public', '@smoke', '@release', '@prod'] },
	() => {
		test('R1 the landing page skeleton is fully rendered', async ({ page }) => {
			await page.goto('/');
			await expect(page).toHaveTitle(/Smart Shelter/);
			await expect(
				page.getByRole('heading', { name: 'แพลตฟอร์มช่วยเหลือผู้ประสบภัย', level: 1 })
			).toBeVisible();
			await expect(
				page.locator('main header').getByRole('link', { name: 'ลงทะเบียนล่วงหน้า', exact: true })
			).toBeVisible();
			await expect(
				page.getByRole('textbox', { name: 'พิมพ์ชื่อ-นามสกุล, เลขประจำตัว' })
			).toBeVisible();
			await expect(page.getByRole('button', { name: 'ค้นหา', exact: true })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'รับบริจาคด่วน', exact: true })).toBeVisible();
		});

		test('navigates to the shelter directory and back home', async ({ page }) => {
			await page.goto('/');
			await expect(
				page.getByRole('heading', { name: 'แพลตฟอร์มช่วยเหลือผู้ประสบภัย' })
			).toBeVisible();

			await page
				.getByRole('link', { name: 'ค้นหาศูนย์พักพิง เช็คพิกัดและศูนย์พักพิงที่เปิดรับ' })
				.click();
			await expect(page).toHaveURL(/\/shelters/);
			await expect(page.getByRole('heading', { name: 'ค้นหาและตัวกรอง' })).toBeVisible();

			await page.getByRole('link', { name: 'หน้าแรก' }).click();
			await expect(page).toHaveURL(/\/$/);
		});

		test('hero search hands the query to /search', async ({ page }) => {
			await page.goto('/');
			await page
				.getByRole('textbox', { name: 'พิมพ์ชื่อ-นามสกุล, เลขประจำตัว' })
				.fill('นายทดสอบ ระบบค้นหา');
			await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();

			await expect(page).toHaveURL(/\/search\?q=/);
			await expect(
				page.getByRole('textbox', {
					name: 'พิมพ์ชื่อ สกุล เบอร์โทรศัพท์ หรือ รหัสบัตรประชาชน'
				})
			).toHaveValue('นายทดสอบ ระบบค้นหา');
		});
	}
);

test.describe('Public landing: smoke extras', { tag: ['@public', '@smoke'] }, () => {
	test('empty hero search opens the family search dialog', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'ค้นหา', exact: true }).click();

		await expect(page.getByRole('dialog', { name: 'ค้นหาผู้พักพิง' })).toBeVisible();
		await expect(page.getByRole('textbox', { name: 'คำค้นหา' })).toBeVisible();
		await page.getByRole('button', { name: 'Close' }).click();
		await expect(page.getByRole('dialog', { name: 'ค้นหาผู้พักพิง' })).toBeHidden();
	});

	test('opens the donation list and the tracking page', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('link', { name: 'รายการทั้งหมด' }).click();
		await expect(page).toHaveURL(/\/donations$/);

		await page.goto('/');
		await page.getByRole('link', { name: 'ตรวจสอบสถานะ' }).click();
		await expect(page).toHaveURL(/\/donations\/track$/);
	});

	test('volunteer missions show the under-development notice', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'ดูงานอาสาสมัครทั้งหมด' }).first().click();

		await expect(page.getByRole('dialog', { name: 'ระบบอยู่ระหว่างการพัฒนา' })).toBeVisible();
		await page.getByRole('button', { name: 'รับทราบ' }).click();
		await expect(page.getByRole('dialog', { name: 'ระบบอยู่ระหว่างการพัฒนา' })).toBeHidden();
	});

	test('switches the page between Thai and English', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('button', { name: 'Switch to English' }).click();
		await expect(
			page.getByRole('heading', { name: 'Urgent Donation Needs', exact: true })
		).toBeVisible();
		await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();

		await page.getByRole('button', { name: 'เปลี่ยนเป็นภาษาไทย' }).click();
		await expect(page.getByRole('heading', { name: 'รับบริจาคด่วน', exact: true })).toBeVisible();
	});
});

test.describe('Public landing: error contract', { tag: ['@public', '@smoke'] }, () => {
	test('a failing needs/shelters list still leaves the landing shell usable', async ({ page }) => {
		await page.route('**/api/public/v1/needs', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.route('**/api/public/v1/shelters', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/');
		await expect(
			page.getByRole('heading', { name: 'แพลตฟอร์มช่วยเหลือผู้ประสบภัย', level: 1 })
		).toBeVisible();
		await expect(
			page.locator('main header').getByRole('link', { name: 'ลงทะเบียนล่วงหน้า', exact: true })
		).toBeVisible();
	});

	test('says the system is unavailable when the needs list fails (#740)', async ({ page }) => {
		await page.route('**/api/public/v1/needs', (route) =>
			route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/');
		await expect(page.getByText('ระบบขัดข้อง')).toBeVisible();
		await expect(
			page.getByText('ไม่สามารถเชื่อมต่อฐานข้อมูลได้ กรุณาลองใหม่ภายหลัง')
		).toBeVisible();
	});

	test('says so in English too when the shelters list fails (#740)', async ({ page }) => {
		await page.route('**/api/public/v1/shelters', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ error: 'UPSTREAM_DOWN' })
			})
		);
		await page.goto('/');
		await expect(page.getByRole('alert').filter({ hasText: 'ระบบขัดข้อง' })).toBeVisible();

		await page.getByRole('button', { name: 'Switch to English' }).click();
		await expect(page.getByRole('alert').filter({ hasText: 'System Error' })).toBeVisible();
		await expect(
			page.getByText('Cannot connect to database. Please try again later.')
		).toBeVisible();
	});

	test('shows no error when both lists load', async ({ page }) => {
		await page.route('**/api/public/v1/needs', (route) =>
			route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
		);
		await page.route('**/api/public/v1/shelters', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ shelters: [] })
			})
		);
		await page.goto('/');
		await expect(
			page.getByRole('heading', { name: 'แพลตฟอร์มช่วยเหลือผู้ประสบภัย', level: 1 })
		).toBeVisible();
		await expect(page.getByText('ระบบขัดข้อง')).toHaveCount(0);
	});
});

test.describe('Public landing: volunteer card (#709)', { tag: ['@public', '@smoke'] }, () => {
	const job = (overrides: Record<string, unknown>) => ({
		shelter_code: 'SH901',
		shelter_name: 'ศูนย์ทดสอบการ์ดจิตอาสา',
		description: '',
		tier: 'operational',
		skills_required: [],
		shift_template: { shift_name: '', start_time: '', end_time: '', days: [] },
		shifts: [],
		quota: 10,
		status: 'open',
		requires_review: false,
		...overrides
	});

	test('counts only open urgent jobs and lists them by shelter', async ({ page }) => {
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					success: true,
					jobs: [
						job({
							job_id: 'job:u1',
							title: 'งานครัวด่วน',
							is_urgent: true,
							slots_remaining: 6,
							slots_confirmed: 4
						}),
						job({
							job_id: 'job:u2',
							title: 'คัดแยกของด่วน',
							is_urgent: true,
							slots_remaining: 2,
							slots_confirmed: 3
						}),
						job({
							job_id: 'job:n1',
							title: 'งานทั่วไป',
							is_urgent: false,
							slots_remaining: 50,
							slots_confirmed: 9
						})
					]
				})
			})
		);

		await page.goto('/');

		await expect(page.getByText('ต้องการอีก 8 คน')).toBeVisible();
		await expect(page.getByText('(มีแล้ว 7 คน)')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'ศูนย์ทดสอบการ์ดจิตอาสา' })).toBeVisible();
		await expect(page.getByText('งานครัวด่วน')).toBeVisible();
		await expect(page.getByText('งานทั่วไป')).toHaveCount(0);
		// The card's apply button opens the board filtered to that shelter.
		await expect(page.getByRole('link', { name: 'สมัครจิตอาสา' })).toHaveAttribute(
			'href',
			'/volunteers/jobs?shelter=SH901'
		);
	});

	test('shows a dash, not 0, when the job board cannot be read', async ({ page }) => {
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill({
				status: 503,
				contentType: 'application/json',
				body: JSON.stringify({ success: false, jobs: [] })
			})
		);

		await page.goto('/');

		await expect(page.getByText('ต้องการอีก — คน')).toBeVisible();
		await expect(page.getByText('(มีแล้ว — คน)')).toBeVisible();
		// The mission list says the same, rather than claiming there are no urgent missions.
		await expect(
			page.getByRole('alert').filter({ hasText: 'โหลดงานอาสาสมัครเร่งด่วนไม่ได้ในขณะนี้' })
		).toBeVisible();
		await expect(page.getByText('ขณะนี้ยังไม่มีงานอาสาสมัครที่เปิดรับสมัครเร่งด่วน')).toHaveCount(
			0
		);
		await expect(
			page.getByRole('heading', { name: 'แพลตฟอร์มช่วยเหลือผู้ประสบภัย', level: 1 })
		).toBeVisible();
	});
});
