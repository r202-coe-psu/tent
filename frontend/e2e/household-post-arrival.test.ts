/**
 * E2E: Household Post-arrival Grouping (Path C) — full flows against the REAL CouchDB
 *
 * Evacuees who were checked in one by one at intake are grouped into a household
 * afterwards (1 head → 2 members → 3 address → 4 pets/assets/vehicles → 5 zone →
 * 6 summary). Nothing on the staff plane is mocked; each flow re-reads the
 * persisted docs to prove what was saved.
 *
 * Arrange: the intake staff account "checked in" these evacuees earlier — seeded
 * straight into `shelter_sh001` with `created_by` = that account (a checked-in
 * evacuee is the precondition of this page, not what it tests):
 *
 *   HEAD, MEMBER        active, no household
 *   MOVER               active, non-head member of OLD_HH (checked_in)
 *   OLD_HEAD            active, head of OLD_HH, which still has MOVER in it
 *   PRE                 pre_registered — not checked in yet
 *   LONER               active, no household (homeless path)
 *   PAIR_HEAD, PAIR_MEMBER  active, no household (C6)
 *
 * Sub-paths covered, in order:
 *
 *   C1  Step 1 guards — PRE can't be picked (not checked in), OLD_HEAD can't be
 *       picked (heads a household with other members); "ถัดไป" stays disabled
 *       until a head is chosen; "เปลี่ยนคน" clears the pick. Nothing is written.
 *   C2  Staff A groups HEAD + MEMBER + MOVER: add → remove → re-add a member,
 *       MOVER leaves OLD_HH, the address step rejects empty input, going back
 *       from step 4 keeps the saved address and the members, a pet (terms must be ticked), the other zone.
 *   C3  Staff A groups LONER alone as homeless — geography only, no house number.
 *   C4  Staff A tries to regroup HEAD — now heads C2's household with members,
 *       so HEAD shows as taken.
 *   C6  Staff A (recorded with codegen): a head + one member, housing type and
 *       landmark, a different subdistrict (→ 90110), then the QR card PDF.
 *   C5  Account switch to the SH001 shelter manager: sees C2's household with all
 *       three members; a warehouse-only account is turned away from the page.
 *
 *   A1  Access by role (docs/prd/role-permission-matrix.md, Evacuee / Household
 *       row; guard `requireEvacueeRegistration`): system_admin, the SH001 shelter
 *       manager, SH001 registration_staff — alone or alongside another capability —
 *       reach step 1 of the wizard.
 *   A2  Every other SH001 capability (and a shelter scope with no capability), alone
 *       or combined, is sent away from the page and writes nothing. Each case mints
 *       its own throwaway account, so A1/A2 run independently of the flows above.
 *
 * Clean-up (afterAll): every doc in `shelter_sh001` created by the test accounts
 * (seeded evacuees + households, and the households the wizard created) is
 * deleted, then the accounts themselves.
 *
 * Run headed:
 *   pnpm exec playwright test e2e/household-post-arrival.test.ts --headed
 */

import { test, expect, type Page } from '@playwright/test';
import {
	COUCH_BASE,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES,
	type TestUser
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const SHELTER_DB = 'shelter_sh001';
const RUN_ID = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const RUN_NUM = String(Date.now()).slice(-7);

const INTAKE: TestUser = {
	name: `postarr_intake_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Post-Arrival Intake Staff'
};
const STAFF_A: TestUser = {
	name: `postarr_a_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Post-Arrival Staff A'
};
const MANAGER: TestUser = {
	name: `postarr_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Post-Arrival Shelter Manager'
};
const WAREHOUSE: TestUser = {
	name: `postarr_wh_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Post-Arrival Warehouse'
};
const USERS = [INTAKE, STAFF_A, MANAGER, WAREHOUSE];
const sessions: Record<string, string> = {};

// ─── Seeded evacuees ───────────────────────────────────────────────────────────

type Person = { id: string; firstName: string; lastName: string; nationalId: string };

/** Every last name carries RUN_ID, so searching for it only ever finds this run's people. */
const person = (key: string, firstName: string, n: number): Person => ({
	id: `evacuee:E2EPA${RUN_ID.toUpperCase()}${key}`,
	firstName,
	lastName: `กลุ่มบ้าน${RUN_ID}`,
	nationalId: `2${RUN_NUM}${String(n).padStart(5, '0')}`
});
const fullName = (p: Person) => `${p.firstName} ${p.lastName}`;

const HEAD = person('HEAD', 'สมบัติ', 1);
const MEMBER = person('MEMBER', 'สมพร', 2);
const MOVER = person('MOVER', 'ย้ายมา', 3);
const OLD_HEAD = person('OLDHEAD', 'เจ้าบ้านเดิม', 4);
const PRE = person('PRE', 'ยังไม่มา', 5);
const LONER = person('LONER', 'ไร้บ้าน', 6);
const PAIR_HEAD = person('PAIRHEAD', 'คุณานนท์', 7);
const PAIR_MEMBER = person('PAIRMEMBER', 'เจนนาม', 8);

const OLD_HH_ID = `household:E2EPA${RUN_ID.toUpperCase()}OLD`;
const OLD_HH_LABEL = `ครอบครัว${fullName(OLD_HEAD)}`;

// SH001 master data: Z1 = โซน A (recommended), Z2 = โซน B.
const RECOMMENDED_ZONE = { code: 'Z1', name: 'โซน A' };
const OTHER_ZONE = { code: 'Z2', name: 'โซน B' };

const ADDRESS = {
	zone: 'เขตเทศบาลนครหาดใหญ่',
	community: 'ชุมชนหลังศูนย์',
	addressNo: `${RUN_NUM}/9`,
	villageNo: 'หมู่ 3',
	notes: 'มาถึงพร้อมกัน รถกระบะ 1 คัน'
};

const created = { groupedHouseholdId: '' };

function evacueeDoc(p: Person, stay: 'active' | 'pre_registered', householdId: string | null) {
	const now = new Date().toISOString();
	return {
		_id: p.id,
		type: 'evacuee',
		schema_v: 10,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: INTAKE.name,
		first_name: p.firstName,
		last_name: p.lastName,
		gender: 'male',
		phone: null,
		person_id: { cardType: 'national_id', number: p.nationalId },
		religion: 'buddhist',
		country: 'THAILAND',
		vulnerable_groups: [],
		special_needs: [],
		household_id: householdId,
		current_stay: {
			status: stay,
			zone: stay === 'active' ? RECOMMENDED_ZONE.code : null,
			since: now
		},
		privacy: { search_excluded: false },
		registered_via: 'staff'
	};
}

function oldHouseholdDoc() {
	const now = new Date().toISOString();
	return {
		_id: OLD_HH_ID,
		type: 'household',
		schema_v: 5,
		shelter_code: 'SH001',
		created_at: now,
		updated_at: now,
		created_by: INTAKE.name,
		label: OLD_HH_LABEL,
		head_evacuee_id: OLD_HEAD.id,
		status: 'checked_in',
		checkout_destination: null,
		municipality_zone: 'เขตเทศบาลนครหาดใหญ่',
		community: 'ชุมชนเดิม',
		pets: [],
		assets: null,
		vehicles: [],
		housing_type: 'owned_house',
		residence_landmark: null,
		address_no: `${RUN_NUM}/1`,
		village_no: 'หมู่ 1',
		subdistrict: 'บ้านพรุ',
		district: 'หาดใหญ่',
		province: 'สงขลา',
		postal_code: '90250'
	};
}

async function seedEvacuees(): Promise<void> {
	const res = await couchReq('POST', `/${SHELTER_DB}/_bulk_docs`, {
		docs: [
			evacueeDoc(HEAD, 'active', null),
			evacueeDoc(MEMBER, 'active', null),
			evacueeDoc(MOVER, 'active', OLD_HH_ID),
			evacueeDoc(OLD_HEAD, 'active', OLD_HH_ID),
			evacueeDoc(PRE, 'pre_registered', null),
			evacueeDoc(LONER, 'active', null),
			evacueeDoc(PAIR_HEAD, 'active', null),
			evacueeDoc(PAIR_MEMBER, 'active', null),
			oldHouseholdDoc()
		]
	});
	const failed = (res.data as { error?: string }[]).filter((r) => r.error);
	if (res.status >= 400 || failed.length > 0) {
		throw new Error(`Seeding evacuees failed (HTTP ${res.status}): ${JSON.stringify(failed)}`);
	}
}

// ─── Real-CouchDB helpers (admin, Node side) ───────────────────────────────────

/** The `pnpm preview` server playwright.config.ts starts (its `baseURL`). */
const APP_BASE_URL = 'http://localhost:4173';

type CouchDoc = Record<string, unknown> & { _id: string; _rev: string };

/**
 * The `test`-mode build points the browser straight at CouchDB (`COUCH_BASE`), which
 * has no CORS locally. Re-send those calls through the preview server's same-origin
 * `/couch` proxy (the `daily-sop.test.ts` pattern) — the data still comes from the real DB.
 */
async function routeCouchThroughApp(page: Page): Promise<void> {
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
		try {
			const response = await route.fetch({
				url: `${APP_BASE_URL}/couch${origin.pathname}${origin.search}`
			});
			await route.fulfill({ response, headers: { ...response.headers(), ...corsHeaders } });
		} catch {
			// The page closed mid-request (e.g. a long-poll `_changes` at test end).
		}
	});
}

/**
 * A freshly minted user has no `security_question`, and the post-login gate sends
 * anyone in that state to `/force-setup` before any back-office route renders. Seed
 * one so these tests exercise the wizard and not the onboarding flow.
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

/** The shell re-renders once the session is verified and the shelter doc arrives — type only after. */
async function waitForAppSettled(page: Page, shelterCode = 'SH001'): Promise<void> {
	await expect(page.getByRole('button', { name: 'เลือกศูนย์อพยพ' })).toContainText(shelterCode, {
		timeout: 20_000
	});
}

async function findDocs(selector: Record<string, unknown>): Promise<CouchDoc[]> {
	const res = await couchReq('POST', `/${SHELTER_DB}/_find`, { selector, limit: 1000 });
	if (res.status !== 200) throw new Error(`_find on ${SHELTER_DB} failed (HTTP ${res.status})`);
	return (res.data as { docs: CouchDoc[] }).docs;
}

async function getDoc(id: string): Promise<CouchDoc> {
	const res = await couchReq('GET', `/${SHELTER_DB}/${encodeURIComponent(id)}`);
	if (res.status !== 200) throw new Error(`GET ${SHELTER_DB}/${id} failed (HTTP ${res.status})`);
	return res.data as CouchDoc;
}

/**
 * Delete every doc in `shelter_sh001` whose `created_by` is one of `names`. Deleting
 * (not purging) lets the sync worker see the tombstones and drop the Mongo projections too.
 */
async function deleteDocsCreatedBy(names: string[]): Promise<void> {
	const docs = await findDocs({ created_by: { $in: names } });
	if (docs.length === 0) return;
	const res = await couchReq('POST', `/${SHELTER_DB}/_bulk_docs`, {
		docs: docs.map((d) => ({ _id: d._id, _rev: d._rev, _deleted: true }))
	});
	if (res.status >= 400) throw new Error(`Clean-up _bulk_docs failed (HTTP ${res.status})`);
}

// ─── Browser helpers ───────────────────────────────────────────────────────────

async function openWizardAs(page: Page, user: TestUser): Promise<void> {
	await routeCouchThroughApp(page);
	await injectSession(page, user, sessions[user.name]);
	await page.goto('/back-office/households/new');
	await waitForAppSettled(page);
	await expect(
		page.getByRole('heading', { name: '1. ตรวจสอบและเลือกหัวหน้าครัวเรือน' })
	).toBeVisible();
}

const SEARCH_PLACEHOLDER = 'เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล...';
const nextStep = (page: Page) => page.getByRole('button', { name: 'ขั้นตอนถัดไป' });
const nextToAssets = (page: Page) =>
	page.getByRole('button', { name: 'ถัดไป (ทรัพย์สินและสัตว์เลี้ยง) →' });
const nextToZone = (page: Page) => page.getByRole('button', { name: 'ถัดไป (จัดสรรพื้นที่)' });

/** One search hit (name + its action buttons). */
const searchHit = (page: Page, p: Person) =>
	page
		.locator('div.justify-between')
		.filter({ has: page.getByText(fullName(p), { exact: true }) })
		.filter({ has: page.getByRole('button', { name: 'ดูโปรไฟล์' }) })
		.first();

async function search(page: Page, query: string): Promise<void> {
	await page.getByPlaceholder(SEARCH_PLACEHOLDER).fill(query);
}

/** Step 2's right-hand "รายชื่อในครอบครัว (n คน)" card. */
const familyList = (page: Page) =>
	page
		.locator('div.rounded-xl')
		.filter({ has: page.getByRole('heading', { name: /รายชื่อในครอบครัว/ }) });

async function pickHead(page: Page, p: Person): Promise<void> {
	await search(page, fullName(p));
	await searchHit(page, p).getByRole('button', { name: 'เลือกเป็นหัวหน้า' }).click();
	await expect(page.getByText('หัวหน้าครัวเรือนที่เลือก')).toBeVisible();
}

async function addMember(page: Page, p: Person): Promise<void> {
	await search(page, fullName(p));
	await searchHit(page, p).getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
	await expect(searchHit(page, p).getByRole('button', { name: 'เพิ่มแล้ว ✓' })).toBeDisabled();
}

/** The geography pickers here are comboboxes named by their field labels. */
async function pickFromCombobox(page: Page, label: string, value: string) {
	await page.getByRole('combobox', { name: label }).click();
	await page.getByRole('option', { name: value, exact: true }).click();
}

async function fillGeography(page: Page): Promise<void> {
	await pickFromCombobox(page, 'จังหวัด *', 'สงขลา');
	await pickFromCombobox(page, 'อำเภอ / เขต *', 'หาดใหญ่');
	await pickFromCombobox(page, 'ตำบล / แขวง *', 'บ้านพรุ');
	await expect(page.getByRole('textbox', { name: 'รหัสไปรษณีย์' })).toHaveValue('90250');
}

async function expectSummary(page: Page, memberCount: number) {
	await expect(
		page.getByRole('heading', { name: 'จัดกลุ่มครอบครัวและออกรหัสครัวเรือนสำเร็จ!' })
	).toBeVisible({ timeout: 20_000 });
	await expect(
		page.getByRole('heading', { name: new RegExp(`\\(${memberCount} คน\\)`) })
	).toBeVisible();
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Household post-arrival grouping — real CouchDB', () => {
	// Each flow builds on the docs the previous one wrote.
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		for (const user of USERS) {
			await createCouchUser(user);
			await seedSecurityQuestion(user.name);
			sessions[user.name] = await couchLogin(user.name, user.password);
		}
		await seedEvacuees();
	});

	test.afterAll(async () => {
		const names = USERS.map((u) => u.name);
		await deleteDocsCreatedBy(names);
		expect(await findDocs({ created_by: { $in: names } }), 'clean-up left nothing').toHaveLength(0);
		for (const user of USERS) await deleteCouchUser(user.name);
	});

	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	test('C1 — only a checked-in evacuee who is free to move can be picked as head', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);
		await expect(nextStep(page)).toBeDisabled();

		// Everyone from this run, one search.
		await search(page, RUN_ID);
		await expect(searchHit(page, HEAD)).toBeVisible({ timeout: 15_000 });

		// Not checked in yet → greyed-out status instead of a pick button.
		await expect(
			searchHit(page, PRE).getByRole('button', { name: 'ลงทะเบียนล่วงหน้า' })
		).toBeDisabled();
		// Heads a household that still has members → flagged, no pick button.
		await expect(searchHit(page, OLD_HEAD)).toContainText(`สังกัด: ${OLD_HH_LABEL}`);
		await expect(
			searchHit(page, OLD_HEAD).getByRole('button', { name: 'เลือกเป็นหัวหน้า' })
		).toHaveCount(0);
		// A non-head member of that household may still leave it (CR-106).
		await expect(
			searchHit(page, MOVER).getByRole('button', { name: 'เลือกเป็นหัวหน้า' })
		).toBeEnabled();

		// Pick, change mind, pick again.
		await searchHit(page, HEAD).getByRole('button', { name: 'เลือกเป็นหัวหน้า' }).click();
		await expect(page.getByText('หัวหน้าครัวเรือนที่เลือก')).toBeVisible();
		await expect(nextStep(page)).toBeEnabled();
		await page.getByRole('button', { name: 'เปลี่ยนคน' }).click();
		await expect(nextStep(page)).toBeDisabled();

		expect(await findDocs({ type: 'household', created_by: STAFF_A.name })).toHaveLength(0);
	});

	test('C2 — staff A groups a head, a member and someone moving out of another household', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);

		// Step 1
		await pickHead(page, HEAD);
		await nextStep(page).click();

		// Step 2: the head is already in the list and can't be removed.
		await expect(
			page.getByRole('heading', { name: '2. ค้นหาและเลือกสมาชิกในครัวเรือน' })
		).toBeVisible();
		const list = familyList(page);
		await expect(list).toContainText('(1 คน)');
		await expect(list).toContainText('หัวหน้า');

		// Add MEMBER, take them off again, add them back; then MOVER.
		await addMember(page, MEMBER);
		await expect(list).toContainText('(2 คน)');
		await list
			.locator('div.justify-between')
			.filter({ hasText: fullName(MEMBER) })
			.getByRole('button')
			.last()
			.click();
		await expect(list).toContainText('(1 คน)');
		await addMember(page, MEMBER);
		await addMember(page, MOVER);
		await expect(list).toContainText('(3 คน)');
		await nextStep(page).click();

		// Step 3: empty submit is rejected.
		await expect(page.getByRole('textbox', { name: 'ชื่อเรียกครัวเรือน' })).toHaveValue(
			`ครอบครัว${fullName(HEAD)}`
		);
		await nextToAssets(page).click();
		await expect(page.getByText('กรุณาเลือกจังหวัด')).toBeVisible();
		await expect(page.getByText('กรุณากรอกบ้านเลขที่')).toBeVisible();

		await page.getByRole('textbox', { name: 'เขตเทศบาล (Zone)' }).fill(ADDRESS.zone);
		await page.getByRole('textbox', { name: 'ชุมชนในศูนย์ (Community)' }).fill(ADDRESS.community);
		await page.getByPlaceholder('เช่น 12/3').fill(ADDRESS.addressNo);
		await page.getByPlaceholder('เช่น หมู่ 2').fill(ADDRESS.villageNo);
		await fillGeography(page);
		await page.getByPlaceholder('ระบุหมายเหตุ หรือรายละเอียดอื่นๆ...').fill(ADDRESS.notes);

		await nextToAssets(page).click();

		// 4 → 3 → 2 and forward again: the saved address and the members survive.
		// (Only a submitted address is kept — backing out of step 3 before "ถัดไป" drops it.)
		await expect(page.getByRole('heading', { name: 'สัตว์เลี้ยงที่นำมาด้วย' })).toBeVisible();
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
		await expect(page.getByPlaceholder('เช่น 12/3')).toHaveValue(ADDRESS.addressNo);
		await expect(page.getByRole('textbox', { name: 'รหัสไปรษณีย์' })).toHaveValue('90250');
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
		await expect(familyList(page)).toContainText('(3 คน)');
		await nextStep(page).click();
		await expect(page.getByRole('textbox', { name: 'บันทึกเพิ่มเติม' })).toHaveValue(ADDRESS.notes);
		await nextToAssets(page).click();

		// Step 4: one dog — the shelter terms must be ticked first.
		await page.getByRole('button', { name: 'มีสัตว์เลี้ยงมาด้วย' }).click();
		await expect(nextToZone(page)).toBeDisabled();
		await page
			.getByRole('checkbox', { name: 'ฉันได้อ่านและยอมรับข้อตกลงและเงื่อนไขข้างต้น' })
			.check();
		await nextToZone(page).click();

		// Step 5: the other zone.
		await page.getByRole('button', { name: 'เลือกโซนอื่น' }).click();
		await page.getByRole('button', { name: new RegExp(OTHER_ZONE.name) }).click();
		await page.getByRole('button', { name: 'ยืนยันโซนนี้' }).click();

		// Step 6
		await expectSummary(page, 3);
		for (const p of [HEAD, MEMBER, MOVER]) {
			await expect(page.getByRole('row').filter({ hasText: fullName(p) })).toBeVisible();
		}
		await page.getByRole('button', { name: 'เสร็จสิ้นการจัดกลุ่มครอบครัว ✔' }).click();
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);

		// ── Database ──
		const households = await findDocs({ type: 'household', created_by: STAFF_A.name });
		expect(households).toHaveLength(1);
		const household = households[0];
		created.groupedHouseholdId = household._id;
		expect(household).toMatchObject({
			label: `ครอบครัว${fullName(HEAD)}`,
			head_evacuee_id: HEAD.id,
			status: 'checked_in',
			municipality_zone: ADDRESS.zone,
			community: ADDRESS.community,
			address_no: ADDRESS.addressNo,
			village_no: ADDRESS.villageNo,
			subdistrict: 'บ้านพรุ',
			district: 'หาดใหญ่',
			province: 'สงขลา',
			postal_code: '90250',
			notes: ADDRESS.notes,
			pets: [expect.objectContaining({ species: 'dog', count: 1 })]
		});
		for (const p of [HEAD, MEMBER, MOVER]) {
			expect(await getDoc(p.id), fullName(p)).toMatchObject({
				household_id: household._id,
				current_stay: { status: 'active', zone: OTHER_ZONE.code }
			});
		}
		// MOVER left OLD_HH; its head stays put.
		expect(await getDoc(OLD_HEAD.id)).toMatchObject({ household_id: OLD_HH_ID });
		expect(await getDoc(OLD_HH_ID)).toMatchObject({ head_evacuee_id: OLD_HEAD.id });
	});

	test('C3 — staff A groups a homeless evacuee alone with geography only', async ({ page }) => {
		await openWizardAs(page, STAFF_A);
		await pickHead(page, LONER);
		await nextStep(page).click();
		await expect(familyList(page)).toContainText('(1 คน)');
		await nextStep(page).click();

		await page.getByRole('button', { name: 'ประเภทที่อยู่อาศัย' }).click();
		await page.getByRole('option', { name: 'ไร้ที่อยู่อาศัยเป็นหลักแหล่ง' }).click();
		await fillGeography(page);
		await nextToAssets(page).click();
		await nextToZone(page).click();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();
		await expectSummary(page, 1);

		const loner = await getDoc(LONER.id);
		expect(loner.household_id).toMatch(/^household:/);
		expect(loner.household_id).not.toBe(created.groupedHouseholdId);
		expect(await getDoc(loner.household_id as string)).toMatchObject({
			head_evacuee_id: LONER.id,
			housing_type: 'homeless',
			address_no: null,
			subdistrict: 'บ้านพรุ',
			status: 'checked_in'
		});
		expect(loner).toMatchObject({ current_stay: { zone: RECOMMENDED_ZONE.code } });
	});

	test("C4 — the head grouped in C2 can't be grouped again", async ({ page }) => {
		expect(created.groupedHouseholdId, 'C2 must have grouped a household').not.toBe('');
		await openWizardAs(page, STAFF_A);
		await search(page, fullName(HEAD));
		await expect(searchHit(page, HEAD)).toContainText(`สังกัด: ครอบครัว${fullName(HEAD)}`, {
			timeout: 15_000
		});
		await expect(
			searchHit(page, HEAD).getByRole('button', { name: 'เลือกเป็นหัวหน้า' })
		).toHaveCount(0);
		await expect(nextStep(page)).toBeDisabled();
	});

	// Recorded with `pnpm exec playwright codegen`, then tidied into the suite's helpers.
	test('C6 — staff A groups a pair with housing type and landmark, then prints the QR card', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);
		await pickHead(page, PAIR_HEAD);
		await nextStep(page).click();
		await addMember(page, PAIR_MEMBER);
		await expect(familyList(page)).toContainText('(2 คน)');
		await nextStep(page).click();

		await page.getByRole('textbox', { name: 'เขตเทศบาล (Zone)' }).fill('เทศบาล1');
		await page.getByRole('textbox', { name: 'ชุมชนในศูนย์ (Community)' }).fill('ชุมชนหาดใหญ่');
		await page.getByRole('button', { name: 'ประเภทที่อยู่อาศัย' }).click();
		await page.getByRole('option', { name: 'บ้านตนเอง' }).click();
		await page.getByRole('textbox', { name: 'จุดสังเกตที่อยู่' }).fill('ปากซอย');
		await page.getByRole('textbox', { name: 'บ้านเลขที่ *' }).fill(`${RUN_NUM}/3`);
		await page.getByRole('textbox', { name: 'หมู่ที่ / ตรอก / ซอย / ถนน' }).fill('หมู่2');
		await pickFromCombobox(page, 'จังหวัด *', 'สงขลา');
		await pickFromCombobox(page, 'อำเภอ / เขต *', 'หาดใหญ่');
		await pickFromCombobox(page, 'ตำบล / แขวง *', 'คลองแห');
		await expect(page.getByRole('textbox', { name: 'รหัสไปรษณีย์' })).toHaveValue('90110');
		await nextToAssets(page).click();
		await nextToZone(page).click();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();
		await expectSummary(page, 2);

		// QR card → "print" opens the PDF in a new window.
		await page.getByRole('button', { name: 'ออกและพิมพ์ QR ประจำตัว' }).click();
		await expect(
			page.getByRole('img', { name: `QR Code สำหรับ ${fullName(PAIR_HEAD)}` })
		).toBeVisible();
		const pdfPopup = page.waitForEvent('popup');
		await page.getByRole('button', { name: 'พิมพ์บัตรประจำตัว' }).click();
		await (await pdfPopup).close();
		await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
		await page.getByRole('button', { name: 'เสร็จสิ้นการจัดกลุ่มครอบครัว ✔' }).click();
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);

		// ── Database ──
		const head = await getDoc(PAIR_HEAD.id);
		expect(await getDoc(head.household_id as string)).toMatchObject({
			label: `ครอบครัว${fullName(PAIR_HEAD)}`,
			head_evacuee_id: PAIR_HEAD.id,
			status: 'checked_in',
			housing_type: 'owned_house',
			residence_landmark: 'ปากซอย',
			subdistrict: 'คลองแห',
			postal_code: '90110',
			municipality_zone: 'เทศบาล1',
			community: 'ชุมชนหาดใหญ่',
			pets: [],
			vehicles: [],
			assets: null
		});
		expect(await getDoc(PAIR_MEMBER.id)).toMatchObject({
			household_id: head.household_id,
			current_stay: { zone: RECOMMENDED_ZONE.code }
		});
	});

	test("C5 — the shelter manager sees the grouped household; warehouse staff can't group", async ({
		page
	}) => {
		await routeCouchThroughApp(page);
		await injectSession(page, MANAGER, sessions[MANAGER.name]);
		await page.goto('/back-office/evacuee-management?tab=household');
		await waitForAppSettled(page);
		const row = page.getByRole('row').filter({ hasText: `ครอบครัว${fullName(HEAD)}` });
		await expect(row).toBeVisible({ timeout: 20_000 });
		for (const p of [HEAD, MEMBER, MOVER]) await expect(row).toContainText(fullName(p));

		await clearSession(page);
		await injectSession(page, WAREHOUSE, sessions[WAREHOUSE.name]);
		await page.goto('/back-office/households/new');
		await expect(page).not.toHaveURL(/\/households\/new/, { timeout: 15_000 });
		expect(await findDocs({ created_by: WAREHOUSE.name })).toHaveLength(0);
	});
});

// ─── Access by role ────────────────────────────────────────────────────────────

const WIZARD_PATH = '/back-office/households/new';
const WIZARD_URL = /\/back-office\/households\/new/;

type AccessCase = { tag: string; label: string; roles: string[] };

/** Who the matrix lets record households: SA, SM in scope, REG in scope. */
const ALLOWED: AccessCase[] = [
	{ tag: 'sa', label: 'system_admin', roles: ['system_admin'] },
	{ tag: 'sm', label: 'SH001 shelter_manager', roles: SM_SH001_ROLES },
	{ tag: 'reg', label: 'SH001 registration_staff', roles: STAFF_SH001_ROLES },
	{
		tag: 'regtri',
		label: 'SH001 registration_staff + triage_staff',
		roles: ['shelter:SH001', 'registration_staff', 'triage_staff']
	}
];

/** Every other shelter capability — none of them may record households. */
const DENIED: AccessCase[] = [
	{ tag: 'tri', label: 'triage_staff', roles: ['shelter:SH001', 'triage_staff'] },
	{ tag: 'med', label: 'medical_staff', roles: ['shelter:SH001', 'medical_staff'] },
	{ tag: 'kit', label: 'kitchen_staff', roles: ['shelter:SH001', 'kitchen_staff'] },
	{ tag: 'sup', label: 'supply_coordinator', roles: ['shelter:SH001', 'supply_coordinator'] },
	{ tag: 'wh', label: 'warehouse_staff', roles: ['shelter:SH001', 'warehouse_staff'] },
	{ tag: 'vol', label: 'volunteer_coordinator', roles: ['shelter:SH001', 'volunteer_coordinator'] },
	{ tag: 'sec', label: 'security_officer', roles: ['shelter:SH001', 'security_officer'] },
	{ tag: 'fac', label: 'facility_staff', roles: ['shelter:SH001', 'facility_staff'] },
	{
		tag: 'multi',
		label: 'volunteer_coordinator + supply_coordinator + kitchen_staff',
		roles: ['shelter:SH001', 'volunteer_coordinator', 'supply_coordinator', 'kitchen_staff']
	},
	{ tag: 'scope', label: 'shelter scope with no capability', roles: ['shelter:SH001'] }
];

/** Mint a throwaway account holding `roles`, run `body` as it, then drop the account. */
async function withAccount(
	{ tag, roles }: AccessCase,
	body: (user: TestUser, session: string) => Promise<void>
): Promise<void> {
	const user: TestUser = {
		name: `postarr_acl_${tag}_${RUN_ID}`,
		password: 'Password1!',
		roles,
		display_name: `ACL ${tag}`
	};
	await createCouchUser(user);
	try {
		await seedSecurityQuestion(user.name);
		await body(user, await couchLogin(user.name, user.password));
	} finally {
		await deleteCouchUser(user.name);
	}
}

test.describe('Household post-arrival grouping — who may open the wizard', () => {
	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	for (const access of ALLOWED) {
		test(`A1 — ${access.label} reaches step 1`, async ({ page }) => {
			await withAccount(access, async (user, session) => {
				await routeCouchThroughApp(page);
				await injectSession(page, user, session);
				await page.goto(WIZARD_PATH);
				await expect(
					page.getByRole('heading', { name: '1. ตรวจสอบและเลือกหัวหน้าครัวเรือน' })
				).toBeVisible({
					timeout: 20_000
				});
				await expect(page).toHaveURL(WIZARD_URL);
			});
		});
	}

	for (const access of DENIED) {
		test(`A2 — ${access.label} is turned away`, async ({ page }) => {
			await withAccount(access, async (user, session) => {
				await routeCouchThroughApp(page);
				await injectSession(page, user, session);
				await page.goto(WIZARD_PATH);
				await expect(page).not.toHaveURL(WIZARD_URL, { timeout: 15_000 });
				await expect(
					page.getByRole('heading', { name: '1. ตรวจสอบและเลือกหัวหน้าครัวเรือน' })
				).toHaveCount(0);
				expect(await findDocs({ created_by: user.name })).toHaveLength(0);
			});
		});
	}
});
