/**
 * E2E: Household Pre-registration — full flows against the REAL CouchDB
 *
 * Nothing on the staff plane is mocked: every wizard step writes to `shelter_sh001`
 * exactly as it would when a staff member clicks through it, and each flow
 * re-reads the persisted docs to prove what was saved.
 *
 * Sub-paths through the 5-step wizard (1 head → 2 address → 3 pets/assets/vehicles
 * → 4 zone → 5 summary/members) covered here, in order:
 *
 *   P1  Validation guards — bad national ID / phone / missing address never
 *       leave their step, and nothing is written.
 *   P2  Back navigation — 2→1, 3→2, 4→3 keep what was already typed.
 *   P3  Staff A: new household, nothing brought along, recommended zone,
 *       add one member (no phone) on step 5, open the QR, finish.
 *   P4  Staff A: new household bringing a pet, assets and a vehicle (step 3 is
 *       locked until the shelter terms are ticked), head with no phone, picks
 *       the non-recommended zone.
 *   P5  Staff B (account switch): a new head at P3's address — the residence
 *       suggestion offers P3's household; B JOINS it (no new household, assets
 *       merged onto the existing one).
 *   P6  Staff B: same address again, but chooses "สร้างครอบครัวใหม่ที่อยู่นี้"
 *       — a separate household is created despite the suggestion.
 *   P7  Account switch to the SH001 shelter manager: sees Staff A's households
 *       in the household list. A warehouse-only account is turned away from
 *       the pre-register page.
 *   P8  Staff A (recorded with codegen): the optional detail — birth year,
 *       a health condition (own `medical:` doc), housing type + landmark,
 *       forgetting the zone/community once, peeking at other zones, a pregnant
 *       member with a national ID, and printing the QR card PDF.
 *
 *   A1  Access by role (docs/prd/role-permission-matrix.md, Evacuee / Household
 *       row; guard `requireEvacueeRegistration`): system_admin, the SH001 shelter
 *       manager, SH001 registration_staff — alone or alongside another capability —
 *       reach step 1 of the wizard.
 *   A2  Every other SH001 capability (and a shelter scope with no capability), alone
 *       or combined, is sent away from the page and writes nothing. Each case mints
 *       its own throwaway account, so A1/A2 run independently of the flows above.
 *
 * Browser → CouchDB goes through `routeCouchThroughApp` (below) —
 * a transport workaround for missing CORS; the data still comes from the real DB.
 *
 * Clean-up (afterAll): every doc in `shelter_sh001` created by the test
 * accounts (evacuees, households, medical records) is deleted, then the
 * accounts themselves.
 * Deleting (not purging) lets the sync worker drop the Mongo projections too.
 *
 * Run headed:
 *   pnpm exec playwright test e2e/household-pre-register.test.ts --headed
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
/** Digits only — feeds national IDs / house numbers so each run's data is unique. */
const RUN_NUM = String(Date.now()).slice(-7);

const STAFF_A: TestUser = {
	name: `prereg_a_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Pre-Reg Staff A'
};
const STAFF_B: TestUser = {
	name: `prereg_b_${RUN_ID}`,
	password: 'Password1!',
	roles: STAFF_SH001_ROLES,
	display_name: 'Pre-Reg Staff B'
};
const MANAGER: TestUser = {
	name: `prereg_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Pre-Reg Shelter Manager'
};
const WAREHOUSE: TestUser = {
	name: `prereg_wh_${RUN_ID}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'warehouse_staff'],
	display_name: 'Pre-Reg Warehouse'
};
const USERS = [STAFF_A, STAFF_B, MANAGER, WAREHOUSE];
const sessions: Record<string, string> = {};

// ─── Fixtures ──────────────────────────────────────────────────────────────────

type HeadInput = {
	nationalId: string;
	firstName: string;
	lastName: string;
	/** `null` → tick "ไม่มีเบอร์โทร". */
	phone: string | null;
	emergencyName: string;
	emergencyPhone: string;
};

type AddressInput = {
	zone: string;
	community: string;
	addressNo: string;
	villageNo: string;
};

const nationalId = (suffix: string) => `1${RUN_NUM}${suffix}`.padEnd(13, '0').slice(0, 13);

/** Last names carry RUN_ID so rows are findable in lists and never clash between runs. */
const HEAD_P3: HeadInput = {
	nationalId: nationalId('11111'),
	firstName: 'วิชัย',
	lastName: `มั่นคง${RUN_ID}`,
	phone: '0812345678',
	emergencyName: 'สมใจ มั่นคง',
	emergencyPhone: '0898765432'
};
const MEMBER_P3 = { firstName: 'มานี', lastName: `มั่นคง${RUN_ID}` };
const HEAD_P4: HeadInput = {
	nationalId: nationalId('22222'),
	firstName: 'สมศรี',
	lastName: `รักสัตว์${RUN_ID}`,
	phone: null,
	emergencyName: 'สมหมาย รักสัตว์',
	emergencyPhone: '0891112222'
};
const HEAD_P5: HeadInput = {
	nationalId: nationalId('33333'),
	firstName: 'ประเสริฐ',
	lastName: `มั่นคง${RUN_ID}`,
	phone: '0823334444',
	emergencyName: 'วิชัย มั่นคง',
	emergencyPhone: '0812345678'
};
const HEAD_P6: HeadInput = {
	nationalId: nationalId('44444'),
	firstName: 'อำนาจ',
	lastName: `แยกบ้าน${RUN_ID}`,
	phone: '0845556666',
	emergencyName: 'อำไพ แยกบ้าน',
	emergencyPhone: '0867778888'
};

const HEAD_P8: HeadInput = {
	nationalId: nationalId('55555'),
	firstName: 'สมชาย',
	lastName: `ชาติฉกาจ${RUN_ID}`,
	phone: '0847471711',
	emergencyName: 'สมศักดิ์ ชาติฉกาจ',
	emergencyPhone: '0814518785'
};
const MEMBER_P8 = {
	nationalId: nationalId('66666'),
	firstName: 'สมหญิง',
	lastName: `ชาติฉกาจ${RUN_ID}`,
	phone: '0834345354'
};

/** P3/P5/P6 share this address — that is what drives the residence suggestion. */
const SHARED_ADDRESS: AddressInput = {
	zone: 'เขตเทศบาลนครหาดใหญ่',
	community: 'ชุมชน E2E',
	addressNo: `${RUN_NUM}/1`,
	villageNo: 'หมู่ 4'
};
const P4_ADDRESS: AddressInput = {
	zone: 'เขตเทศบาลนครหาดใหญ่',
	community: 'ชุมชน E2E',
	addressNo: `${RUN_NUM}/2`,
	villageNo: 'หมู่ 5'
};

const P8_ADDRESS: AddressInput = {
	zone: 'เทศบาล 1',
	community: 'ชุมชนหาดใหญ่',
	addressNo: `${RUN_NUM}/3`,
	villageNo: 'หมู่ 2'
};

// Master data for this shelter (registry `shelter:…` for SH001): Z1 = โซน A, Z2 = โซน B.
const RECOMMENDED_ZONE = { code: 'Z1', name: 'โซน A' };
const OTHER_ZONE = { code: 'Z2', name: 'โซน B' };

/** Filled in as flows run; later flows (P5/P7) build on P3/P4's households. */
const created = {
	p3HouseholdId: '',
	p4HouseholdId: ''
};

/** The head evacuee this run registered with the given national ID. */
async function findEvacueeByNationalId(id: string): Promise<CouchDoc> {
	const docs = await findDocs({ type: 'evacuee', 'person_id.number': id });
	expect(docs, `exactly one evacuee with national ID ${id}`).toHaveLength(1);
	return docs[0];
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

/** Log in as `user` and land on the pre-register wizard, ready to type. */
async function openWizardAs(page: Page, user: TestUser): Promise<void> {
	await routeCouchThroughApp(page);
	await injectSession(page, user, sessions[user.name]);
	await page.goto('/back-office/households/pre-register');
	await waitForAppSettled(page);
	await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible();
}

const nextToAddress = (page: Page) =>
	page.getByRole('button', { name: 'ถัดไป (ข้อมูลที่อยู่ครัวเรือน) →' });
const nextToAssets = (page: Page) =>
	page.getByRole('button', { name: 'ถัดไป (ทรัพย์สินและสัตว์เลี้ยง) →' });
const nextToZone = (page: Page) => page.getByRole('button', { name: 'ถัดไป (จัดสรรพื้นที่)' });

/** Declaring pets/assets/vehicles brings up the shelter's terms — step 3 is locked until ticked. */
async function acknowledgeDisclaimer(page: Page): Promise<void> {
	await expect(
		page.getByRole('heading', { name: 'ข้อตกลงและเงื่อนไขของศูนย์พักพิง' })
	).toBeVisible();
	await expect(nextToZone(page)).toBeDisabled();
	await page
		.getByRole('checkbox', { name: 'ฉันได้อ่านและยอมรับข้อตกลงและเงื่อนไขข้างต้น' })
		.check();
	await expect(nextToZone(page)).toBeEnabled();
}

async function fillHead(page: Page, head: HeadInput): Promise<void> {
	await page.getByRole('textbox', { name: 'เลขประจำตัวประชาชน *' }).fill(head.nationalId);
	await page.getByRole('textbox', { name: 'ชื่อ (First Name) *' }).fill(head.firstName);
	await page.getByRole('textbox', { name: 'นามสกุล (Last Name)' }).fill(head.lastName);
	if (head.phone === null) {
		await page.getByRole('checkbox', { name: 'ไม่มีเบอร์โทร' }).check();
	} else {
		await page.getByRole('textbox', { name: 'เบอร์โทรศัพท์ยืนยันตัวตน *' }).fill(head.phone);
	}
	await page
		.getByRole('textbox', { name: 'ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน *' })
		.fill(head.emergencyName);
	await page.getByRole('textbox', { name: 'เบอร์ติดต่อฉุกเฉิน *' }).fill(head.emergencyPhone);
}

async function pickFromSearchSelect(page: Page, placeholder: string, value: string) {
	await page.getByRole('button', { name: placeholder }).click();
	await page.getByRole('button', { name: value, exact: true }).click();
}

async function fillAddress(page: Page, address: AddressInput): Promise<void> {
	await expect(page.getByRole('heading', { name: 'ข้อมูลครัวเรือนเบื้องต้น' })).toBeVisible();
	await page.getByRole('textbox', { name: 'เขตการปกครอง *' }).fill(address.zone);
	await page.getByRole('textbox', { name: 'ชุมชน *' }).fill(address.community);
	await page.getByRole('textbox', { name: 'บ้านเลขที่ *' }).fill(address.addressNo);
	await page.getByRole('textbox', { name: 'หมู่ที่ / ตรอก / ซอย / ถนน *' }).fill(address.villageNo);
	await pickFromSearchSelect(page, 'เลือกจังหวัด...', 'สงขลา');
	await pickFromSearchSelect(page, 'เลือกอำเภอ...', 'หาดใหญ่');
	await pickFromSearchSelect(page, 'เลือกตำบล...', 'บ้านพรุ');
	await expect(page.getByRole('textbox', { name: 'รหัสไปรษณีย์ *' })).toHaveValue('90250');
}

/** Step 1 + step 2 for a brand-new head, stopping on step 3. */
async function goToAssetsStep(page: Page, head: HeadInput, address: AddressInput) {
	await fillHead(page, head);
	await nextToAddress(page).click();
	await fillAddress(page, address);
	await nextToAssets(page).click();
	await expect(page.getByRole('heading', { name: 'สัตว์เลี้ยงที่นำมาด้วย' })).toBeVisible();
}

async function expectSummary(page: Page, memberCount: number) {
	await expect(page.getByRole('heading', { name: 'สร้างครัวเรือนล่วงหน้าสำเร็จ' })).toBeVisible({
		timeout: 20_000
	});
	await expect(
		page.getByRole('heading', { name: `รายชื่อสมาชิกในบ้าน (${memberCount} คน)` })
	).toBeVisible({ timeout: 15_000 });
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Household pre-registration — real CouchDB', () => {
	// Each flow builds on the docs the previous one wrote.
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(async () => {
		for (const user of USERS) {
			await createCouchUser(user);
			await seedSecurityQuestion(user.name);
			sessions[user.name] = await couchLogin(user.name, user.password);
		}
	});

	test.afterAll(async () => {
		await deleteDocsCreatedBy(USERS.map((u) => u.name));
		const leftovers = await findDocs({ created_by: { $in: USERS.map((u) => u.name) } });
		expect(leftovers, 'clean-up left no test docs behind').toHaveLength(0);
		for (const user of USERS) await deleteCouchUser(user.name);
	});

	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
		await clearSession(page);
	});

	test('P1 — invalid input never leaves its step and writes nothing', async ({ page }) => {
		await openWizardAs(page, STAFF_A);

		// National ID shorter than 13 digits.
		await fillHead(page, { ...HEAD_P3, nationalId: '123456' });
		await nextToAddress(page).click();
		await expect(page.getByText('เลขประจำตัวประชาชนต้องมี 13 หลัก').first()).toBeVisible();
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible();

		// Phone shorter than 10 digits.
		await page.getByRole('textbox', { name: 'เลขประจำตัวประชาชน *' }).fill(HEAD_P3.nationalId);
		await page.getByRole('textbox', { name: 'เบอร์โทรศัพท์ยืนยันตัวตน *' }).fill('081234');
		await nextToAddress(page).click();
		await expect(page.getByText(/กรุณากรอกเบอร์โทรศัพท์ 10 หลัก/).first()).toBeVisible();
		await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible();

		// "ไม่มีเบอร์โทร" disables the phone box and lets step 1 through.
		const phone = page.getByRole('textbox', { name: 'เบอร์โทรศัพท์ยืนยันตัวตน *' });
		await page.getByRole('checkbox', { name: 'ไม่มีเบอร์โทร' }).check();
		await expect(phone).toBeDisabled();
		await nextToAddress(page).click();

		// Step 2 with nothing filled in stays on step 2 with field errors.
		await expect(page.getByRole('heading', { name: 'ข้อมูลครัวเรือนเบื้องต้น' })).toBeVisible();
		await nextToAssets(page).click();
		await expect(page.getByText('กรุณาระบุเขตการปกครอง')).toBeVisible();
		await expect(page.getByText('กรุณาระบุชุมชน')).toBeVisible();
		await expect(page.getByText('กรุณาเลือกจังหวัด')).toBeVisible();
		await expect(page.getByRole('heading', { name: 'ข้อมูลครัวเรือนเบื้องต้น' })).toBeVisible();

		// Nothing reaches the database until step 4 is confirmed.
		expect(await findDocs({ created_by: STAFF_A.name })).toHaveLength(0);
	});

	test('P2 — going back keeps what was typed on every step', async ({ page }) => {
		await openWizardAs(page, STAFF_A);
		await goToAssetsStep(page, HEAD_P3, SHARED_ADDRESS);

		// 3 → 2: the address is still there.
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
		await expect(page.getByRole('textbox', { name: 'บ้านเลขที่ *' })).toHaveValue(
			SHARED_ADDRESS.addressNo
		);
		await expect(page.getByRole('textbox', { name: 'ชุมชน *' })).toHaveValue(
			SHARED_ADDRESS.community
		);
		await expect(page.getByRole('textbox', { name: 'ชื่อเรียกครัวเรือน' })).toHaveValue(
			`ครอบครัว${HEAD_P3.firstName} ${HEAD_P3.lastName}`
		);

		// 2 → 1: the head's details are still there.
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
		await expect(page.getByRole('textbox', { name: 'ชื่อ (First Name) *' })).toHaveValue(
			HEAD_P3.firstName
		);
		await expect(page.getByRole('textbox', { name: 'นามสกุล (Last Name)' })).toHaveValue(
			HEAD_P3.lastName
		);

		// Forward again to the zone step, then 4 → 3.
		await nextToAddress(page).click();
		await nextToAssets(page).click();
		await nextToZone(page).click();
		await expect(page.getByRole('heading', { name: RECOMMENDED_ZONE.name })).toBeVisible();
		await page.getByRole('button', { name: 'ย้อนกลับ' }).click();
		await expect(page.getByRole('heading', { name: 'สัตว์เลี้ยงที่นำมาด้วย' })).toBeVisible();

		// Walking back and forth wrote nothing.
		expect(await findDocs({ created_by: STAFF_A.name })).toHaveLength(0);
	});

	test('P3 — staff A pre-registers a household, adds a member, prints QR, finishes', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);
		await goToAssetsStep(page, HEAD_P3, SHARED_ADDRESS);

		// Step 3: nothing brought along.
		await nextToZone(page).click();

		// Step 4: take the recommended zone.
		await expect(page.getByRole('heading', { name: RECOMMENDED_ZONE.name })).toBeVisible();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();

		// Step 5: the head is listed, national ID masked.
		await expectSummary(page, 1);
		const headRow = page
			.getByRole('row')
			.filter({ hasText: `${HEAD_P3.firstName} ${HEAD_P3.lastName}` });
		await expect(headRow).toContainText('หัวหน้าครอบครัว');
		await expect(headRow).toContainText(
			`ID: ${HEAD_P3.nationalId.slice(0, 3)}***${HEAD_P3.nationalId.slice(-3)}`
		);
		await expect(page.locator('main')).not.toContainText(HEAD_P3.nationalId);

		// Add a member with no phone.
		await page.getByRole('button', { name: 'ลงทะเบียนลูกบ้านเพิ่ม' }).click();
		const memberForm = page
			.locator('form')
			.filter({ has: page.getByRole('heading', { name: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' }) });
		await memberForm
			.getByRole('textbox', { name: 'ชื่อ (First Name) *' })
			.fill(MEMBER_P3.firstName);
		await memberForm.getByRole('textbox', { name: 'นามสกุล (Last Name)' }).fill(MEMBER_P3.lastName);
		await memberForm.getByRole('button', { name: 'เพศ *' }).click();
		await page.getByRole('option', { name: 'หญิง (Female)' }).click();
		await memberForm.getByRole('checkbox', { name: 'ไม่มีเบอร์โทร' }).check();
		await memberForm.getByRole('button', { name: 'เพิ่มสมาชิกเข้าร่วมครัวเรือน' }).click();

		await expectSummary(page, 2);
		await expect(
			page.getByRole('row').filter({ hasText: `${MEMBER_P3.firstName} ${MEMBER_P3.lastName}` })
		).toContainText('ลูกบ้าน');

		// QR for the head.
		await page.getByRole('button', { name: 'ออกและพิมพ์ QR ประจำตัว' }).click();
		const qrTitle = page.getByRole('heading', { name: 'บัตรประจำตัวผู้ประสบภัย' });
		await expect(qrTitle).toBeVisible();
		await expect(
			page.getByRole('img', { name: `QR Code สำหรับ ${HEAD_P3.firstName} ${HEAD_P3.lastName}` })
		).toBeVisible();
		await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
		await expect(qrTitle).toBeHidden();

		// Finish → household list.
		await page.getByRole('button', { name: 'เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔' }).click();
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);

		// ── Database ──
		const head = await findEvacueeByNationalId(HEAD_P3.nationalId);
		expect(head).toMatchObject({
			first_name: HEAD_P3.firstName,
			last_name: HEAD_P3.lastName,
			phone: HEAD_P3.phone,
			created_by: STAFF_A.name,
			current_stay: { status: 'pre_registered', zone: RECOMMENDED_ZONE.code },
			emergency_contact: { name: HEAD_P3.emergencyName, phone: HEAD_P3.emergencyPhone }
		});
		const householdId = head.household_id as string;
		expect(householdId).toMatch(/^household:/);
		created.p3HouseholdId = householdId;

		const household = await getDoc(householdId);
		expect(household).toMatchObject({
			type: 'household',
			label: `ครอบครัว${HEAD_P3.firstName} ${HEAD_P3.lastName}`,
			head_evacuee_id: head._id,
			status: 'pre_registered',
			municipality_zone: SHARED_ADDRESS.zone,
			community: SHARED_ADDRESS.community,
			address_no: SHARED_ADDRESS.addressNo,
			village_no: SHARED_ADDRESS.villageNo,
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'บ้านพรุ',
			postal_code: '90250',
			pets: [],
			vehicles: [],
			assets: null,
			created_by: STAFF_A.name
		});

		const [member] = await findDocs({
			type: 'evacuee',
			first_name: MEMBER_P3.firstName,
			last_name: MEMBER_P3.lastName
		});
		expect(member).toMatchObject({
			household_id: householdId,
			phone: null,
			gender: 'female',
			created_by: STAFF_A.name,
			current_stay: { zone: RECOMMENDED_ZONE.code }
		});
	});

	test('P4 — staff A registers a household with pet, assets and vehicle into the other zone', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);
		await goToAssetsStep(page, HEAD_P4, P4_ADDRESS);

		// Step 3: one dog, luggage, one car.
		await page.getByRole('button', { name: 'มีสัตว์เลี้ยงมาด้วย' }).click();
		await page.getByPlaceholder('เช่น ขาว, ชิสุ').first().fill('ด่าง');
		await page.getByRole('button', { name: 'มีทรัพย์สิน/สัมภาระสำคัญ' }).click();
		await page.getByPlaceholder('เช่น กระเป๋าเดินทาง 2 ใบ, ถุงยังชีพ').fill('กระเป๋าเดินทาง 2 ใบ');
		await page.getByRole('button', { name: 'มียานพาหนะ', exact: true }).click();
		await page.getByPlaceholder('เช่น กข 1234 สงขลา').fill('กข 1234 สงขลา');
		await acknowledgeDisclaimer(page);
		await nextToZone(page).click();

		// Step 4: not the recommended zone.
		await expect(page.getByRole('heading', { name: RECOMMENDED_ZONE.name })).toBeVisible();
		await page.getByRole('button', { name: 'เลือกโซนอื่น' }).click();
		await page.getByRole('button', { name: new RegExp(OTHER_ZONE.name) }).click();
		await page.getByRole('button', { name: 'ยืนยันโซนนี้' }).click();

		await expectSummary(page, 1);

		// ── Database ──
		const head = await findEvacueeByNationalId(HEAD_P4.nationalId);
		expect(head).toMatchObject({
			phone: null,
			current_stay: { status: 'pre_registered', zone: OTHER_ZONE.code }
		});
		created.p4HouseholdId = head.household_id as string;

		const household = await getDoc(created.p4HouseholdId);
		expect(household).toMatchObject({
			head_evacuee_id: head._id,
			status: 'pre_registered',
			address_no: P4_ADDRESS.addressNo,
			pets: [expect.objectContaining({ species: 'dog', count: 1, notes: 'ด่าง' })],
			vehicles: [{ type: 'car', license_plate: 'กข 1234 สงขลา' }],
			assets: { description: 'กระเป๋าเดินทาง 2 ใบ', image_url: null }
		});
	});

	test("P5 — staff B joins staff A's household suggested by the same address", async ({ page }) => {
		expect(created.p3HouseholdId, 'P3 must have created a household').not.toBe('');
		await openWizardAs(page, STAFF_B);

		await fillHead(page, HEAD_P5);
		await nextToAddress(page).click();
		await fillAddress(page, SHARED_ADDRESS);

		// The residence suggestion finds P3's household.
		const p3Label = `ครอบครัว${HEAD_P3.firstName} ${HEAD_P3.lastName}`;
		await expect(page.getByText('พบครอบครัวที่อยู่ใกล้เคียง')).toBeVisible({ timeout: 15_000 });
		const suggestion = page.getByRole('listitem').filter({ hasText: p3Label });
		await suggestion.getByRole('button', { name: 'เข้าร่วม' }).click();
		await expect(page.getByText('จะเข้าร่วมครอบครัวที่มีอยู่แล้ว')).toBeVisible();

		await nextToAssets(page).click();
		await page.getByRole('button', { name: 'มีทรัพย์สิน/สัมภาระสำคัญ' }).click();
		await page.getByPlaceholder('เช่น กระเป๋าเดินทาง 2 ใบ, ถุงยังชีพ').fill('ถุงยังชีพ 1 ถุง');
		await acknowledgeDisclaimer(page);
		await nextToZone(page).click();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();

		// Summary is P3's household, now with head + member + this head.
		await expectSummary(page, 3);
		await expect(page.getByText(p3Label).first()).toBeVisible();

		// ── Database ──
		const joined = await findEvacueeByNationalId(HEAD_P5.nationalId);
		expect(joined).toMatchObject({
			household_id: created.p3HouseholdId,
			created_by: STAFF_B.name,
			current_stay: { zone: RECOMMENDED_ZONE.code }
		});
		expect(await findDocs({ type: 'household', created_by: STAFF_B.name })).toHaveLength(0);

		const household = await getDoc(created.p3HouseholdId);
		expect(household).toMatchObject({
			assets: { description: 'ถุงยังชีพ 1 ถุง' },
			created_by: STAFF_A.name
		});
	});

	test('P6 — staff B ignores the suggestion and creates a separate household', async ({ page }) => {
		await openWizardAs(page, STAFF_B);

		await fillHead(page, HEAD_P6);
		await nextToAddress(page).click();
		await fillAddress(page, SHARED_ADDRESS);
		await expect(page.getByText('พบครอบครัวที่อยู่ใกล้เคียง')).toBeVisible({ timeout: 15_000 });
		// Join first, then change mind — the explicit "create new" wins.
		await page.getByRole('button', { name: 'เข้าร่วม' }).first().click();
		await page.getByRole('button', { name: 'สร้างครอบครัวใหม่ที่อยู่นี้' }).click();
		await expect(page.getByText('จะเข้าร่วมครอบครัวที่มีอยู่แล้ว')).toBeHidden();

		await nextToAssets(page).click();
		await nextToZone(page).click();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();
		await expectSummary(page, 1);

		// ── Database ──
		const head = await findEvacueeByNationalId(HEAD_P6.nationalId);
		expect(head.household_id).not.toBe(created.p3HouseholdId);
		const household = await getDoc(head.household_id as string);
		expect(household).toMatchObject({
			label: `ครอบครัว${HEAD_P6.firstName} ${HEAD_P6.lastName}`,
			head_evacuee_id: head._id,
			address_no: SHARED_ADDRESS.addressNo,
			status: 'pre_registered',
			created_by: STAFF_B.name
		});
	});

	// Recorded with `pnpm exec playwright codegen`, then tidied into the suite's helpers.
	test('P8 — staff A fills the optional detail: housing type, health, a pregnant member with ID, prints the card PDF', async ({
		page
	}) => {
		await openWizardAs(page, STAFF_A);

		// Step 1: optional head detail — nickname, birth year (age derives), a condition.
		await fillHead(page, HEAD_P8);
		await page.getByRole('textbox', { name: 'ชื่อเล่น' }).fill('ชาย');
		await page.getByRole('textbox', { name: 'เช่น 2530' }).fill('2500');
		await expect(page.getByRole('textbox', { name: 'อายุ' })).not.toHaveValue('');
		await page
			.getByRole('textbox', { name: 'เช่น เบาหวาน, ความดัน (ถ้าไม่มีให้เว้นว่าง)' })
			.fill('โรคหอบ');
		await nextToAddress(page).click();

		// Step 2: housing type + landmark, a different subdistrict (→ postal code 90110).
		await expect(page.getByRole('heading', { name: 'ข้อมูลครัวเรือนเบื้องต้น' })).toBeVisible();
		await page.getByRole('button', { name: 'ประเภทที่อยู่อาศัย' }).click();
		await page.getByRole('option', { name: 'บ้านตนเอง' }).click();
		await page.getByRole('textbox', { name: 'จุดสังเกตที่อยู่' }).fill('ปากซอย');
		await page.getByRole('textbox', { name: 'บ้านเลขที่ *' }).fill(P8_ADDRESS.addressNo);
		await page
			.getByRole('textbox', { name: 'หมู่ที่ / ตรอก / ซอย / ถนน *' })
			.fill(P8_ADDRESS.villageNo);
		await pickFromSearchSelect(page, 'เลือกจังหวัด...', 'สงขลา');
		await pickFromSearchSelect(page, 'เลือกอำเภอ...', 'หาดใหญ่');
		await pickFromSearchSelect(page, 'เลือกตำบล...', 'คลองแห');
		await expect(page.getByRole('textbox', { name: 'รหัสไปรษณีย์ *' })).toHaveValue('90110');

		// Forgot the zone/community — blocked until they are filled in.
		await nextToAssets(page).click();
		await expect(page.getByText('กรุณาระบุเขตการปกครอง')).toBeVisible();
		await page.getByRole('textbox', { name: 'เขตการปกครอง *' }).fill(P8_ADDRESS.zone);
		await page.getByRole('textbox', { name: 'ชุมชน *' }).fill(P8_ADDRESS.community);
		await nextToAssets(page).click();

		// Step 3 → 4: peek at the other zones, go back to the recommended one.
		await nextToZone(page).click();
		await page.getByRole('button', { name: 'เลือกโซนอื่น' }).click();
		await page.getByRole('button', { name: 'ใช้โซนแนะนำ' }).click();
		await page.getByRole('button', { name: 'ยืนยันโซนแนะนำ' }).click();
		await expectSummary(page, 1);

		// Step 5: a member with a national ID, age, phone and the pregnant chip.
		await page.getByRole('button', { name: 'ลงทะเบียนลูกบ้านเพิ่ม' }).click();
		const memberForm = page
			.locator('form')
			.filter({ has: page.getByRole('heading', { name: 'ลงทะเบียนสมาชิกคนใหม่ในครอบครัว' }) });
		await memberForm
			.getByRole('textbox', { name: 'เลขประจำตัวประชาชน' })
			.fill(MEMBER_P8.nationalId);
		await memberForm
			.getByRole('textbox', { name: 'ชื่อ (First Name) *' })
			.fill(MEMBER_P8.firstName);
		await memberForm.getByRole('textbox', { name: 'นามสกุล (Last Name)' }).fill(MEMBER_P8.lastName);
		await memberForm.getByRole('textbox', { name: 'อายุ' }).fill('58');
		await memberForm.getByRole('button', { name: 'เพศ *' }).click();
		await page.getByRole('option', { name: 'หญิง (Female)' }).click();
		await memberForm
			.getByRole('textbox', { name: 'เบอร์โทรศัพท์ยืนยันตัวตน *' })
			.fill(MEMBER_P8.phone);
		await memberForm.getByRole('button', { name: '🤰 ครรภ์' }).click();
		await memberForm.getByRole('button', { name: 'เพิ่มสมาชิกเข้าร่วมครัวเรือน' }).click();
		await expectSummary(page, 2);

		// QR card → "print" opens the PDF in a new window.
		await page.getByRole('button', { name: 'ออกและพิมพ์ QR ประจำตัว' }).click();
		const pdfPopup = page.waitForEvent('popup');
		await page.getByRole('button', { name: 'พิมพ์บัตรประจำตัว' }).click();
		await (await pdfPopup).close();
		await page.getByRole('button', { name: 'ปิดหน้าต่าง' }).click();
		await page.getByRole('button', { name: 'เสร็จสิ้นการลงทะเบียนล่วงหน้า ✔' }).click();
		await expect(page).toHaveURL(/\/back-office\/evacuee-management\?tab=household/);

		// ── Database ──
		const head = await findEvacueeByNationalId(HEAD_P8.nationalId);
		expect(head).toMatchObject({ nickname: 'ชาย', birth_year: 2500 });
		const [medical] = await findDocs({ type: 'medical', evacuee_id: head._id });
		expect(medical).toMatchObject({ conditions: ['โรคหอบ'], created_by: STAFF_A.name });

		expect(await getDoc(head.household_id as string)).toMatchObject({
			housing_type: 'owned_house',
			residence_landmark: 'ปากซอย',
			subdistrict: 'คลองแห',
			postal_code: '90110',
			municipality_zone: P8_ADDRESS.zone
		});

		const member = await findEvacueeByNationalId(MEMBER_P8.nationalId);
		expect(member).toMatchObject({
			household_id: head.household_id,
			phone: MEMBER_P8.phone,
			gender: 'female',
			vulnerable_groups: ['pregnant'],
			current_stay: { zone: RECOMMENDED_ZONE.code }
		});
	});

	test("P7 — the shelter manager sees staff A's households; warehouse staff is turned away", async ({
		page
	}) => {
		// Shelter manager of SH001.
		await routeCouchThroughApp(page);
		await injectSession(page, MANAGER, sessions[MANAGER.name]);
		await page.goto('/back-office/evacuee-management?tab=household');
		await waitForAppSettled(page);
		const householdRow = (head: HeadInput) =>
			page.getByRole('row').filter({ hasText: `ครอบครัว${head.firstName} ${head.lastName}` });
		// P3's household lists everyone who ended up in it — including staff B's joined head.
		const p3Row = householdRow(HEAD_P3);
		await expect(p3Row).toBeVisible({ timeout: 20_000 });
		await expect(p3Row).toContainText('ลงทะเบียนล่วงหน้า');
		for (const name of [
			`${HEAD_P3.firstName} ${HEAD_P3.lastName}`,
			`${MEMBER_P3.firstName} ${MEMBER_P3.lastName}`,
			`${HEAD_P5.firstName} ${HEAD_P5.lastName}`
		]) {
			await expect(p3Row).toContainText(name);
		}
		await expect(householdRow(HEAD_P4)).toContainText('ลงทะเบียนล่วงหน้า');

		// Same browser, switch to a warehouse-only account.
		await clearSession(page);
		await injectSession(page, WAREHOUSE, sessions[WAREHOUSE.name]);
		await page.goto('/back-office/households/pre-register');
		await expect(page).not.toHaveURL(/\/households\/pre-register/, { timeout: 15_000 });
		expect(await findDocs({ created_by: WAREHOUSE.name })).toHaveLength(0);
	});
});

// ─── Access by role ────────────────────────────────────────────────────────────

const WIZARD_PATH = '/back-office/households/pre-register';
const WIZARD_URL = /\/back-office\/households\/pre-register/;

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
		name: `prereg_acl_${tag}_${RUN_ID}`,
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

test.describe('Household pre-registration — who may open the wizard', () => {
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
				await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toBeVisible({
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
				await expect(page.getByRole('heading', { name: 'ข้อมูลหัวหน้าครัวเรือน' })).toHaveCount(0);
				expect(await findDocs({ created_by: user.name })).toHaveLength(0);
			});
		});
	}
});
