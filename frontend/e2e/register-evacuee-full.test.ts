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

import { test, expect, type Page } from '@playwright/test';
import { createCouchUser, deleteCouchUser, couchLogin, STAFF_SH001_ROLES } from './helpers/couch';
import { injectSession } from './helpers/login';

// ─── Shared fixtures ───────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36);

const TEST_USER = {
	name: `reg_evacuee_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Reg Staff E2E'
};

// TEST_USER's `shelter:SH001` role resolves to this CouchDB database (db/shelter.ts).
const SHELTER_DB = 'shelter_sh001';

// ─── Random test data ──────────────────────────────────────────────────────────
// Small pools of plausible Thai values — randomized per run so the flow isn't
// tied to one fixed name/address, while staying readable in failure output.

const FIRST_NAMES = ['สมชาย', 'สมหญิง', 'วิชัย', 'มาลี', 'ประยุทธ์'] as const;
const LAST_NAMES = ['ใจดี', 'รักไทย', 'สุขสันต์', 'แสงทอง', 'ศรีสุข'] as const;
const SUBDISTRICTS = ['บ้านพรุ', 'คอหงส์', 'ควนลัง', 'ท่าข้าม'] as const;
const DISTRICTS = ['หาดใหญ่', 'เมืองสงขลา', 'สะเดา'] as const;
const PROVINCES = ['สงขลา', 'ปัตตานี', 'สตูล'] as const;

function randomInt(min: number, max: number): number {
	return Math.floor(Math.random() * (max - min + 1)) + min;
}

function pick<T>(items: readonly T[]): T {
	return items[randomInt(0, items.length - 1)];
}

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

	/**
	 * Mount all CouchDB / BFF route mocks needed to drive all 6 steps.
	 * Keeps the test self-contained — no real CouchDB data is mutated.
	 * Skill note: "Avoid mocking where possible" — we only mock the DB/BFF
	 * layer; the full SvelteKit BFF and Svelte UI run against the real preview
	 * server.
	 */
	async function mockCouchRoutes(page: Page) {
		// CouchDB _changes (live-sync) — return empty immediately to avoid timeouts
		await page.route('**/_changes**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ results: [], last_seq: '0' })
			});
		});

		// Mango _find (search) — default: return empty list (no prior registrations)
		await page.route('**/_find**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ docs: [], bookmark: 'nil' })
			});
		});

		// CouchDB _all_docs — listEvacuees()/listHouseholds()/searchEvacuees() scan by
		// type prefix via _all_docs; default to empty (no prior registrations), so
		// step 4's household search reliably falls into the "not found" path.
		await page.route('**/_all_docs**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ rows: [] })
			});
		});

		// Shelter registry — useShelter() scans the `registry` db's _all_docs for
		// `shelter:*` docs (not a BFF route). One shelter (SH001) with one open zone,
		// needed for step 6's zone recommendation/selection. Registered after the
		// generic _all_docs mock above so it takes precedence for this path.
		await page.route('**/registry/_all_docs**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					rows: [
						{
							id: 'shelter:SH001',
							doc: {
								_id: 'shelter:SH001',
								_rev: '1-mock',
								type: 'shelter',
								schema_v: 4,
								code: 'SH001',
								name: 'ศูนย์พักพิง E2E',
								operation_status: 'active',
								capacity: 100,
								zones: [
									{
										code: 'A',
										name: 'โซน A (ทั่วไป)',
										capacity: 50,
										type: 'general',
										status: 'active'
									}
								],
								admission_policy: {
									supported_vulnerable_groups: [],
									pet_policy: { policy: null, categories: [] }
								},
								luggage_policy: {
									limitation: null,
									max_per_family: null,
									rules: [],
									rules_other: null
								},
								parking_policy: {
									availability: null,
									supported_vehicles: [],
									rules: [],
									rules_other: null
								}
							}
						}
					]
				})
			});
		});

		// Shelter DB (evacuee/household/movement/medical/screening docs) — a tiny
		// in-memory doc store so the GET-after-PUT rev lookups used throughout the
		// flow (updateEvacuee, checkInEvacuee, …) resolve against what was actually
		// written, instead of a fixed canned response.
		const docs = new Map<string, Record<string, unknown>>();
		let revCounter = 0;
		await page.route(`**/${SHELTER_DB}/**`, async (route) => {
			const req = route.request();
			const segments = new URL(req.url()).pathname.split('/').filter(Boolean);
			const last = segments[segments.length - 1] ?? '';
			if (last.startsWith('_')) {
				// Not a single-doc path (_all_docs, _find, _changes, …) — defer to
				// the generic mocks registered above.
				await route.fallback();
				return;
			}

			const docId = decodeURIComponent(last);
			if (req.method() === 'GET') {
				const doc = docs.get(docId);
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
				const isCreate = !docs.has(docId);
				revCounter += 1;
				const rev = `${revCounter}-mock`;
				docs.set(docId, { ...body, _id: docId, _rev: rev });
				await route.fulfill({
					status: isCreate ? 201 : 200,
					contentType: 'application/json',
					body: JSON.stringify({ ok: true, id: docId, rev })
				});
				return;
			}
			await route.fallback();
		});

		// Thailand location lookup (address dropdown — not used by the exact-match
		// household path this test drives through, but harmless to mock).
		await page.route('**/api/v1/thailand-location/all**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify([
					{ province: 'สงขลา', district: 'หาดใหญ่', subdistrict: 'บ้านพรุ', zipcode: 90250 }
				])
			});
		});

		// Vulnerable-group master data (step 3 tags section) — no groups configured,
		// this flow doesn't select any.
		await page.route('**/api/back-office/master-data/vulnerable_group**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({
					_id: 'master_data:vulnerable_group',
					master_type: 'vulnerable_group',
					items: []
				})
			});
		});

		// BFF passthrough (any other SvelteKit server route)
		await page.route('/api/**', async (route) => {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify({ ok: true })
			});
		});
	}

	test('should complete evacuee registration end-to-end across all 6 steps', async ({ page }) => {
		// Arrange — randomize the evacuee name and new-household address per run
		const firstName = pick(FIRST_NAMES);
		const lastName = pick(LAST_NAMES);
		const addressNo = `${randomInt(1, 300)}/${randomInt(1, 20)}`;
		const villageNo = `หมู่ ${randomInt(1, 15)}`;
		const subdistrict = pick(SUBDISTRICTS);
		const district = pick(DISTRICTS);
		const province = pick(PROVINCES);
		const postalCode = String(randomInt(10000, 99999));

		// Arrange — mount mocks before navigation, then land on the wizard already
		// authenticated (no login-form / logout roundtrip needed for this flow).
		await mockCouchRoutes(page);
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
		await page.getByPlaceholder('ชื่อจริง').fill(firstName);
		await page.getByPlaceholder('นามสกุล', { exact: true }).fill(lastName);
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
		await page.getByPlaceholder('เช่น 12/3').fill(addressNo);
		await page.getByPlaceholder('เช่น หมู่ 2').fill(villageNo);
		await page.getByPlaceholder('เช่น บ้านพรุ').fill(subdistrict);
		await page.getByPlaceholder('เช่น หาดใหญ่').fill(district);
		await page.getByPlaceholder('เช่น สงขลา').fill(province);
		await page.getByPlaceholder('เช่น 90250').fill(postalCode);
		await page.getByRole('button', { name: 'ถัดไป (ข้อมูลสัตว์เลี้ยง/ยานพาหนะ)' }).click();

		// ── Step 5: ทรัพย์สินและสัตว์เลี้ยง — nothing to declare, submit as-is ──
		await expect(page.getByText('ทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)')).toBeVisible({
			timeout: 10_000
		});
		await page.getByRole('button', { name: 'ลงทะเบียนสำเร็จ' }).click();

		// Assert — evacuee creation and household-link toasts both fire (this
		// step registers the evacuee, then links it to the new household)
		await expect(page.getByText(`Registered ${firstName} ${lastName}`)).toBeVisible({
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
