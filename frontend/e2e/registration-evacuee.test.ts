/**
 * @quarantine — mutates SH001 toggles + global reCAPTCHA; name-regex teardown (§4 violation).
 * Replaced by `onsite-stations-flow.test.ts` (own `E2E` shelter, ledger teardown). Do not delete
 * until that suite is green on staging; excluded by Playwright `grepInvert: /@quarantine/`.
 *
 * E2E: evacuee registration across Station 1 → 2 → 3 (+ scan check-in/out) on the REAL stack,
 * driven only through the UI — no direct database writes. SH001's toggles are flipped on the
 * shelter edit page, reCAPTCHA on /system-management/security, ids are read from the printed
 * Person QRs, and statuses are asserted from the Station 1 search row. The only Couch calls are
 * the throw-away staff users (helpers/couch.ts), seeding their security question (as in
 * stock-donations.test.ts), and the teardown that deletes the people this run created.
 *
 * Four serial tests, the same two flows with SH001's switches ON, then pre-registration and
 * Station 2 OFF:
 *   ON  (every switch on: pre-registration, Station 2, pets, assets, vehicles)
 *       1.1 walk-in (search → new/joined household → pet, vehicle, assets, zone, QR → Station 2 → 3
 *           → scan out/in)
 *       1.2 pre-register on the public site (screen A) → report-in by search + QR scan at the desk
 *           (screen B) → Station 2 → 3 → scan out
 *   OFF (pre-registration and Station 2 off; pets/assets/vehicles stay as the ON run left them)
 *       1.3 walk-in; Station 2 is skipped
 *       1.4 public booking is refused → central queue (screen A) → desk claims by search + QR scan
 *           (screen B) → Station 3 → scan out
 * Pet, vehicle and asset steps run when their switch is on and are skipped (annotated in the
 * report) when it is off.
 * After each toggle change the run waits SYNC_WORKER_DELAY_MS (default 10 s, E2E_SYNC_DELAY_MS).
 *
 * Needs: the stack up (`docker compose up -d`) with FastAPI built from this checkout
 * (`docker compose build fastapi`), seeded SH001, and a same-origin-proxy build
 * (`PUBLIC_COUCH_PROXY=/couch pnpm exec vite build --mode test`). Start the preview yourself
 * (pnpm 12: Playwright can't stop the server it spawns and hangs), then run:
 *   SECRET_RECAPTCHA_KEY=e2e-recaptcha-secret COUCHDB_ADMIN_URL=http://admin:password@localhost:5984 \
 *     pnpm preview &
 *   pnpm playwright test e2e/registration-evacuee.test.ts     # E2E_DEBUG=1 logs 4xx/5xx responses
 *
 * Side effects: the switches and reCAPTCHA are flipped back afterwards (not if the run is killed),
 * but saving pets/assets/vehicles rewrites the shelter's pet/luggage/parking policies and flipping
 * the switch back does not undo that. People can't be deleted from the UI, so afterAll tombstones
 * them through CouchDB admin (evacuee, household, medical, movement, screening, audit), matched on
 * this run's Tst… last-name tag. Public POSTs allow 3/min/IP, so a run waits ~1 min once.
 */

import { createRequire } from 'node:module';
import process from 'node:process';
import {
	test,
	expect,
	type Browser,
	type Locator,
	type Page,
	type Response
} from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	type TestUser
} from './helpers/couch';
import { injectSession } from './helpers/login';

const nodeRequire = createRequire(import.meta.url);

// ─── Run identity ──────────────────────────────────────────────────────────────

/**
 * Letters-only per-run tag. No digit at all: a digit in a queue search also matches phone / ID
 * substrings (matchesEvacueeSearch), which would pull leftover people from earlier runs into results.
 */
function makeRunTag(): string {
	const digits = Date.now().toString().slice(-8);
	return 'Tst' + digits.replace(/\d/g, (d) => 'abcdefghij'[Number(d)]);
}

/** Valid Thai national ID (13 digits, mod-11 checksum). */
function makeThaiNationalId(seed: number): string {
	const body = String(1_000_000_000_00 + (seed % 8_999_999_999_99)).slice(0, 12);
	let sum = 0;
	for (let i = 0; i < 12; i++) sum += Number(body[i]) * (13 - i);
	return body + String((11 - (sum % 11)) % 10);
}

/** Unique-enough 10-digit mobile number. */
function makePhone(seed: number): string {
	return '08' + String(10_000_000 + (seed % 89_999_999));
}

const RUN_TAG = makeRunTag();
const SEED = Number(Date.now().toString().slice(-9));

/** Time given to the sync worker to project a change to the public plane. */
const SYNC_WORKER_DELAY_MS = Number(process.env.E2E_SYNC_DELAY_MS ?? 10_000);

// Zone names from the seeded SH001.
const ZONE_GYM_1 = 'อาคารยิมเนเซียม 1';
const ZONE_GYM_2 = 'อาคารยิมเนเซียม 2';
const ZONE_VULNERABLE = 'โซนดูแลกลุ่มเปราะบาง';

/** Stay-status labels as shown in the UI. */
const STATUS = {
	arriving: 'รอเข้าพัก',
	active: 'เข้าพักแล้ว',
	roomConfirmed: 'ยืนยันถึงโซนแล้ว',
	checkedOut: 'เช็คเอาต์'
} as const;

// ─── Shelter toggles (shelter edit page → "คุณสมบัติการปฏิบัติการ") ────────────

interface Toggles {
	/** รับลงทะเบียนเข้าพักล่วงหน้าจากหน้าสาธารณะ */
	preRegistration: boolean;
	/** เปิดคัดกรองการแพทย์ (Station 2) */
	medical: boolean;
	/** บันทึกสัตว์เลี้ยงตอนลงทะเบียน */
	pets: boolean;
	/** บันทึกทรัพย์สิน / สัมภาระตอนลงทะเบียน */
	assets: boolean;
	/** บันทึกยานพาหนะตอนลงทะเบียน */
	vehicles: boolean;
}

const TOGGLE_SELECTOR: Record<keyof Toggles, string> = {
	preRegistration: '#accepts-pre-registration',
	medical: '#enable-medical-screening',
	pets: '#allow-pets',
	assets: '#allow-assets',
	vehicles: '#allow-vehicles'
};
const TOGGLE_KEYS = Object.keys(TOGGLE_SELECTOR) as Array<keyof Toggles>;

async function openShelterEditor(page: Page): Promise<void> {
	await page.goto('/back-office/shelters/edit/SH001');
	await expect(page.locator(TOGGLE_SELECTOR.preRegistration)).toBeVisible({ timeout: 20_000 });
}

async function readToggles(page: Page): Promise<Toggles> {
	await openShelterEditor(page);
	const out = {} as Toggles;
	for (const key of TOGGLE_KEYS) {
		out[key] = (await page.locator(TOGGLE_SELECTOR[key]).getAttribute('aria-checked')) === 'true';
	}
	return out;
}

/** Flip the switches that differ from `target`, save, reload and return what the page shows. */
async function setToggles(page: Page, target: Partial<Toggles>): Promise<Toggles> {
	await openShelterEditor(page);
	let changed = false;
	for (const key of TOGGLE_KEYS) {
		const want = target[key];
		if (want === undefined) continue;
		const sw = page.locator(TOGGLE_SELECTOR[key]);
		if ((await sw.getAttribute('aria-checked')) === String(want)) continue;
		await sw.click();
		await expect(sw).toHaveAttribute('aria-checked', String(want));
		changed = true;
	}
	if (changed) {
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).first().click();
		await expect(page.getByText('อัปเดตข้อมูลศูนย์พักพิง SH001 สำเร็จ').first()).toBeVisible({
			timeout: 20_000
		});
	}
	return readToggles(page);
}

/** Set the reCAPTCHA switch; returns its previous state. */
async function setRecaptcha(page: Page, enabled: boolean): Promise<boolean> {
	await page.goto('/system-management/security');
	const sw = page.locator('#recaptcha-enabled');
	await expect(sw).toBeVisible({ timeout: 20_000 });
	const before = (await sw.getAttribute('aria-checked')) === 'true';
	if (before !== enabled) {
		await sw.click();
		await expect(
			page.getByText(enabled ? 'เปิดใช้งาน reCAPTCHA แล้ว' : 'ปิดใช้งาน reCAPTCHA แล้ว')
		).toBeVisible({
			timeout: 20_000
		});
	}
	return before;
}

/** Wait for the sync worker to project the last change. */
async function waitForSyncWorker(page: Page): Promise<void> {
	await page.waitForTimeout(SYNC_WORKER_DELAY_MS);
}

// ─── Users / sessions ──────────────────────────────────────────────────────────

/** Also seeds a security question so /force-setup does not intercept (as stock-donations.test.ts). */
async function createStaffUser(user: TestUser): Promise<void> {
	await createCouchUser(user);
	const path = `/_users/org.couchdb.user:${encodeURIComponent(user.name)}`;
	const doc = (await couchReq('GET', path)).data as Record<string, unknown>;
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
	if (res.status >= 400)
		throw new Error(`Could not finish setup for "${user.name}" (${res.status})`);
}

// ─── Teardown — delete the data this run created ───────────────────────────────

const SHELTER_DB = 'shelter_sh001';
const EVACUEE_RANGE = { $gt: 'evacuee:', $lt: 'evacuee:￰' };

interface CouchDoc {
	_id: string;
	_rev: string;
	household_id?: string | null;
}

async function findDocs(selector: Record<string, unknown>): Promise<CouchDoc[]> {
	const res = await couchReq('POST', `/${SHELTER_DB}/_find`, { selector, limit: 100_000 });
	if (res.status >= 400) throw new Error(`_find on ${SHELTER_DB} failed (${res.status})`);
	return (res.data as { docs?: CouchDoc[] }).docs ?? [];
}

/**
 * Delete every doc this run created. Plain deletes (tombstones), not `_purge`: the sync worker only
 * sees deletes in `_changes`. People are matched on RUN_TAG in the last name, so nobody else in
 * SH001 is touched; a household is kept if anyone from outside this run still lives in it.
 */
async function deleteRunData(): Promise<number> {
	const evacuees = await findDocs({ _id: EVACUEE_RANGE, last_name: { $regex: RUN_TAG } });
	if (evacuees.length === 0) return 0;
	const evacueeIds = new Set(evacuees.map((d) => d._id));
	const householdIds = [
		...new Set(evacuees.map((d) => d.household_id).filter((id): id is string => Boolean(id)))
	];

	const residents = householdIds.length
		? await findDocs({ _id: EVACUEE_RANGE, household_id: { $in: householdIds } })
		: [];
	const sharedHouseholds = new Set(
		residents.filter((d) => !evacueeIds.has(d._id)).map((d) => d.household_id)
	);
	const ownHouseholdIds = householdIds.filter((id) => !sharedHouseholds.has(id));

	const ids = [...evacueeIds];
	const [households, perEvacuee, audits] = await Promise.all([
		ownHouseholdIds.length ? findDocs({ _id: { $in: ownHouseholdIds } }) : [],
		// medical, movement, screening
		findDocs({ evacuee_id: { $in: ids } }),
		findDocs({ target_id: { $in: [...ids, ...ownHouseholdIds] } })
	]);

	const docs = new Map<string, CouchDoc>();
	for (const doc of [...evacuees, ...households, ...perEvacuee, ...audits]) docs.set(doc._id, doc);

	const res = await couchReq('POST', `/${SHELTER_DB}/_bulk_docs`, {
		docs: [...docs.values()].map(({ _id, _rev }) => ({ _id, _rev, _deleted: true }))
	});
	if (res.status >= 400) throw new Error(`_bulk_docs on ${SHELTER_DB} failed (${res.status})`);
	const failed = (res.data as Array<{ id: string; error?: string; reason?: string }>).filter(
		(r) => r.error
	);
	if (failed.length > 0) {
		throw new Error(
			`Could not delete ${failed.length}/${docs.size} docs: ` +
				failed
					.slice(0, 3)
					.map((f) => `${f.id} (${f.error}: ${f.reason})`)
					.join(', ')
		);
	}
	return docs.size;
}

/** E2E_DEBUG=1: print every 4xx/5xx response. */
function logFailedResponses(page: Page, label: string): void {
	if (!process.env.E2E_DEBUG) return;
	page.on('response', async (res) => {
		if (res.status() < 400) return;
		const cookie = (await res.request().headerValue('cookie')) ?? '(no cookie)';
		const body = await res.text().catch(() => '');
		console.log(
			`${new Date().toISOString()} [${label}] ${res.status()} ${res.request().method()} ${res.url()}\n   cookie=${cookie.slice(0, 40)}… body=${body.slice(0, 200)}`
		);
	});
}

/** Separate browser context signed in as `user`. */
async function openAsStaff(
	browser: Browser,
	user: Pick<TestUser, 'name' | 'roles'>,
	authSession: string
): Promise<Page> {
	const context = await browser.newContext();
	const page = await context.newPage();
	logFailedResponses(page, user.name);
	await injectSession(page, user, authSession);
	return page;
}

// ─── Station 1 — search, scan, unified registration form ───────────────────────

const INTAKE_SEARCH_LABEL = 'เลขบัตรประชาชน / หนังสือเดินทาง / ชื่อ-นามสกุล / เบอร์โทร';

async function openStation1(page: Page): Promise<Locator> {
	await page.goto('/onsite/people');
	await expect(page.getByRole('heading', { name: 'ทะเบียนผู้ประสบภัย' })).toBeVisible({
		timeout: 20_000
	});
	return page.getByLabel(INTAKE_SEARCH_LABEL);
}

/** Type into the Station 1 search box. */
async function searchStation1(page: Page, query: string): Promise<void> {
	await (await openStation1(page)).fill(query);
}

/** Type a scanned payload + Enter, like a keyboard-wedge barcode scanner. */
async function scanIntoStation1(page: Page, payload: string): Promise<void> {
	const box = await openStation1(page);
	await box.fill(payload);
	await box.press('Enter');
}

interface Person {
	firstName: string;
	lastName: string;
	gender: 'male' | 'female';
	nationalId: string;
	phone?: string;
	age?: string;
	/** Vulnerable-group checkbox codes, e.g. `elderly_dependent`. */
	vulnerableGroups?: string[];
	/** Zone name to assign already at Station 1 (leave undefined = "assign later"). */
	zone?: string;
}
const fullName = (p: Pick<Person, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;

/** Fill one member card of the unified registration form. */
async function fillMemberCard(page: Page, index: number, m: Person): Promise<void> {
	const card = page.locator(`#unified-member-${index}`);
	await expect(card).toBeVisible();
	await card.locator(`#member-${index}-card-number`).fill(m.nationalId);
	await card.locator(`#member-${index}-first-name`).fill(m.firstName);
	await card.locator(`#member-${index}-last-name`).fill(m.lastName);
	await card.locator(`#member-${index}-gender-${m.gender}`).click({ force: true });
	if (m.age) await card.locator(`#member-${index}-age`).fill(m.age);
	// "ไม่มีเบอร์โทรศัพท์" is ticked by default — untick to type a number.
	if (m.phone) {
		// The public head has no such checkbox (phone is mandatory there).
		const noPhone = card.locator(`#member-${index}-no-phone`);
		if ((await noPhone.count()) && (await noPhone.getAttribute('aria-checked')) === 'true') {
			await noPhone.click();
		}
		await card.locator(`#member-${index}-phone`).fill(m.phone);
	}
	if (m.vulnerableGroups?.length) {
		await card.getByRole('button', { name: 'กลุ่มเปราะบาง', exact: true }).click();
		for (const code of m.vulnerableGroups) {
			await card.locator(`#vg-${index}-${code}`).click();
		}
	}
	if (m.zone) {
		await card.locator('div.grid button', { hasText: m.zone }).first().click();
	}
}

const ADDRESS_PICKS = [
	['province', 'สงขลา'],
	['district', 'หาดใหญ่'],
	['subdistrict', 'คอหงส์']
] as const;

async function fillAddress(page: Page, addressNo: string, villageNo?: string) {
	await page.locator('#address-no').fill(addressNo);
	if (villageNo) await page.locator('#village-no').fill(villageNo);
	for (const [id, option] of ADDRESS_PICKS) {
		await page.locator(`#${id}`).click();
		await page.getByRole('button', { name: option, exact: true }).click();
	}
}

/** Decode a QR <img> in the page with the app's own html5-qrcode. */
async function decodeQrImage(page: Page, img: Locator): Promise<string> {
	const src = await img.getAttribute('src');
	if (!src?.startsWith('data:image')) throw new Error('QR <img> has no data-URL source');
	if (!(await page.evaluate(() => 'Html5Qrcode' in window))) {
		await page.addScriptTag({ path: nodeRequire.resolve('html5-qrcode/html5-qrcode.min.js') });
	}
	return page.evaluate(async (dataUrl) => {
		const holder = document.createElement('div');
		holder.id = 'e2e-qr-decode';
		holder.style.display = 'none';
		document.body.appendChild(holder);
		const blob = await (await fetch(dataUrl)).blob();
		const file = new File([blob], 'qr.png', { type: blob.type });
		type QrScanner = { scanFile(file: File, showImage: boolean): Promise<string> };
		const { Html5Qrcode } = window as unknown as { Html5Qrcode: new (id: string) => QrScanner };
		const scanner = new Html5Qrcode(holder.id);
		try {
			return await scanner.scanFile(file, false);
		} finally {
			holder.remove();
		}
	}, src);
}

/** On the print screen, read each member's evacuee id from their Person QR. */
async function idsFromPrintScreen(page: Page, people: Person[]): Promise<Record<string, string>> {
	await expect(page.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' })).toBeVisible({
		timeout: 30_000
	});
	await expect(page.getByText(`${people.length} คน`, { exact: true })).toBeVisible();
	const ids: Record<string, string> = {};
	for (const p of people) {
		const qr = page.getByAltText(`QR Code สำหรับ ${fullName(p)}`);
		await expect(qr).toBeVisible({ timeout: 15_000 });
		ids[p.firstName] = await decodeQrImage(page, qr);
		expect(ids[p.firstName]).toMatch(/^evacuee:/);
	}
	return ids;
}

async function finishPrintScreen(page: Page): Promise<void> {
	// Rendered in the summary card and the sticky bar — either works
	await page.getByRole('button', { name: 'กลับคิวทะเบียน' }).first().click();
	await expect(page).toHaveURL(/\/onsite\/people$/);
}

/** Assert status/zone as staff see them in the Station 1 search row. */
async function expectStay(desk: Page, p: Person, status: string, zoneName?: string): Promise<void> {
	await searchStation1(desk, p.nationalId);
	const hit = desk
		.getByRole('listitem')
		.filter({ hasText: fullName(p) })
		.first();
	await expect(hit).toBeVisible({ timeout: 20_000 });
	await expect(hit).toContainText(`สถานะ: ${status}`);
	if (zoneName) await expect(hit).toContainText(`โซน ${zoneName}`);
}

// ─── Station 2 — medical screening ─────────────────────────────────────────────

interface ScreeningFill {
	conditions: string;
	medications?: string;
	allergies?: string;
	/** Free-text general symptoms. */
	notes?: string;
	careTrack?: 'normal' | 'fast_track';
	/** EWAR surveillance symptoms to tick — matched against the checkbox's accessible name. */
	ewarSymptoms?: (string | RegExp)[];
}

/** Screen one person at Station 2. */
async function screenEvacuee(page: Page, evacueeId: string, fill: ScreeningFill): Promise<void> {
	await page.goto(`/onsite/medical-screening/${evacueeId}`);
	await expect(page.getByText('Station 2', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.locator('#med-conditions').fill(fill.conditions);
	if (fill.medications) await page.locator('#med-medications').fill(fill.medications);
	if (fill.allergies) await page.locator('#med-allergies').fill(fill.allergies);
	if (fill.notes) await page.locator('#med-general-symptoms').fill(fill.notes);
	if (fill.careTrack) await page.locator(`label[for="med-care-track-${fill.careTrack}"]`).click();
	for (const symptom of fill.ewarSymptoms ?? []) {
		await page.getByRole('checkbox', { name: symptom }).click();
	}
	await page.getByRole('button', { name: 'บันทึกผลคัดกรอง' }).click();
	await expect(page.getByRole('heading', { name: 'บันทึกผลคัดกรองแล้ว' })).toBeVisible({
		timeout: 20_000
	});
}

/** Toggle on: screen everyone. Toggle off: the "switched off" notice shows instead. */
async function stationTwo(
	clinic: Page,
	flags: Toggles,
	entries: Array<{ id: string; fill: ScreeningFill }>
): Promise<void> {
	if (!flags.medical) {
		await clinic.goto('/onsite/medical-screening');
		await expect(
			clinic.getByRole('heading', { name: 'จุดคัดกรองการแพทย์ถูกปิดใช้งาน' })
		).toBeVisible({ timeout: 20_000 });
		return;
	}
	for (const entry of entries) await screenEvacuee(clinic, entry.id, entry.fill);
}

// ─── Station 3 — zoning ────────────────────────────────────────────────────────

/** Assign a zone and check the person in (→ active). */
async function assignZone(page: Page, evacueeId: string, zoneName: string): Promise<void> {
	await page.goto(`/onsite/zoning/${evacueeId}`);
	await expect(page.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.locator('div.grid button', { hasText: zoneName }).first().click();
	await page.getByRole('button', { name: 'จัดเข้าโซน (รอยืนยันถึงโซน)' }).click();
	await expect(page).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
}

/** Zone Arrival Confirmation: active → room_confirmed. */
async function confirmArrivalInZone(page: Page, evacueeId: string): Promise<void> {
	await page.goto(`/onsite/zoning/${evacueeId}`);
	await expect(page.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
	await page.getByRole('button', { name: 'ยืนยันถึงโซน', exact: true }).click();
	await expect(page).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
}

/** Toggle on: unscreened people are held back; toggle off: listed straight away. */
async function expectZoningQueue(
	desk: Page,
	flags: Toggles,
	query: string,
	people: Person[],
	opts: { screened: boolean }
): Promise<void> {
	await desk.goto('/onsite/zoning');
	await expect(desk.getByText('Cleared for Zoning — คิวพร้อมจัดสรรที่พัก')).toBeVisible({
		timeout: 20_000
	});
	await desk.getByPlaceholder('ค้นหาชื่อ, นามสกุล, เบอร์โทร, เลขบัตร...').fill(query);
	await expect(desk.getByText('กำลังโหลดคิว...')).toHaveCount(0);
	const row = (p: Person) => desk.getByRole('row').filter({ hasText: fullName(p) });
	if (!flags.medical || opts.screened) {
		for (const p of people) {
			// (a person renders as more than one row, so don't count them)
			await expect(row(p).first()).toBeVisible({ timeout: 15_000 });
		}
	} else {
		await expect(desk.getByText(/ต้องผ่านคัดกรองแพทย์ก่อน/)).toBeVisible({ timeout: 15_000 });
		for (const p of people) await expect(row(p)).toHaveCount(0);
	}
}

// ─── Scan check-in / check-out ─────────────────────────────────────────────────

/**
 * Enter a payload on the scan page and untick `others`: the page acts on the whole household in
 * parallel and loses _rev races (409), so the test moves one person at a time.
 */
async function scanAndSelectOnly(page: Page, payload: string, others: string[]): Promise<void> {
	await page.goto('/onsite/scan-check-in-out');
	await expect(page.getByRole('heading', { name: /สแกนเข้า-ออกศูนย์/ })).toBeVisible({
		timeout: 20_000
	});
	await page.getByPlaceholder('กรอกรหัส หรือ สแกน QR...').fill(payload);
	await page.getByRole('button', { name: 'ตกลง' }).click();
	// The family panel only exists when the household has other members.
	if (others.length > 0) {
		await expect(page.getByText('จัดการเช็คอิน/เช็คเอาท์พร้อมกับครอบครัว')).toBeVisible({
			timeout: 15_000
		});
	}
	for (const other of others) {
		const box = page.locator('label', { hasText: other }).locator('input[type=checkbox]');
		if (await box.isEnabled()) await box.uncheck();
	}
}

/** Answer any prompt the action raises, then stop listening. */
async function answeringDialogs(page: Page, answer: string, action: () => Promise<void>) {
	const handler = (dialog: import('@playwright/test').Dialog) =>
		void dialog.accept(answer).catch(() => {});
	page.on('dialog', handler);
	try {
		await action();
	} finally {
		page.off('dialog', handler);
	}
}

async function checkOutByScan(page: Page, id: string, others: string[], reason: string) {
	await scanAndSelectOnly(page, id, others);
	await answeringDialogs(page, reason, async () => {
		await page.getByRole('button', { name: 'เช็คเอาท์' }).click();
		await expect(page.getByText('เช็คเอาท์สำเร็จ 1 คน')).toBeVisible({ timeout: 15_000 });
	});
}

async function checkInByScan(page: Page, id: string, others: string[], zoneCode: string) {
	await scanAndSelectOnly(page, id, others);
	await answeringDialogs(page, zoneCode, async () => {
		await page.getByRole('button', { name: 'เช็คอิน' }).click();
		await expect(page.getByText('เช็คอินสำเร็จ 1 คน')).toBeVisible({ timeout: 15_000 });
	});
}

// ─── Public site ───────────────────────────────────────────────────────────────

/** Submit the public form; on 429 (3/min/IP) wait a minute and retry once. */
async function submitPublicForm(page: Page, apiPath: string): Promise<Record<string, unknown>> {
	const submit = page.getByRole('button', { name: 'ยืนยันการลงทะเบียน' }).last();
	const isPost = (r: Response) =>
		new URL(r.url()).pathname === apiPath && r.request().method() === 'POST';
	const first = page.waitForResponse(isPost);
	await submit.click();
	let res = await first;
	if (res.status() === 429) {
		await page.waitForTimeout(62_000);
		const second = page.waitForResponse(isPost);
		await submit.click();
		res = await second;
	}
	if (!res.ok()) {
		const body = await res.text().catch(() => '');
		throw new Error(`Public form submit failed (${res.status()} ${res.statusText()}): ${body}`);
	}
	return (await res.json()) as Record<string, unknown>;
}

/** One pass over the flows under one state of the toggles. */
interface Run {
	mode: 'On' | 'Off';
	/** What the edit page showed after the toggles were set. */
	flags: Toggles;
	/** Tags every last name. */
	tag: string;
	/** Keeps IDs / phones of the two passes apart. */
	seed: number;
	/** Keeps house numbers apart so "join household" finds only this pass's family. */
	house: number;
}
const ON_TARGET: Toggles = {
	preRegistration: true,
	medical: true,
	pets: true,
	assets: true,
	vehicles: true
};
/** Pets / assets / vehicles are left as the ON run set them, so saving doesn't rewrite policies twice. */
const OFF_TARGET: Partial<Toggles> = { preRegistration: false, medical: false };
/** Placeholder; `applyToggles` replaces it with what the edit page shows before any flow runs. */
const NOT_READ_YET: Toggles = {
	preRegistration: false,
	medical: false,
	pets: false,
	assets: false,
	vehicles: false
};
const ON: Run = { mode: 'On', flags: NOT_READ_YET, tag: `${RUN_TAG}On`, seed: SEED, house: 0 };
const OFF: Run = {
	mode: 'Off',
	flags: NOT_READ_YET,
	tag: `${RUN_TAG}Off`,
	seed: SEED + 500,
	house: 100
};

const REGISTRAR: TestUser = {
	name: `stn_reg_${RUN_TAG.toLowerCase()}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'registration_staff'],
	display_name: 'Registration Desk E2E'
};
// Station 2 operator and shelter editor. Not medical_staff: the registry `_security` omits that
// role, so it gets 403 on the shelter config and Station 2 looks disabled.
const MEDIC: TestUser = {
	name: `stn_med_${RUN_TAG.toLowerCase()}`,
	password: 'Password1!',
	roles: ['shelter:SH001', 'shelter_manager'],
	display_name: 'Medical Desk E2E'
};
// Only for the reCAPTCHA switch.
const ADMIN: TestUser = {
	name: `stn_sa_${RUN_TAG.toLowerCase()}`,
	password: 'Password1!',
	roles: ['system_admin'],
	display_name: 'Settings Admin E2E'
};

test.describe.configure({ mode: 'serial' });
// Fail a stuck locator in seconds, not after the whole test timeout.
test.use({ actionTimeout: 15_000 });

/** Note in the report that a step was left out because a toggle is off. */
function skipped(what: string) {
	test.info().annotations.push({ type: 'skipped (shelter toggle off)', description: what });
}

interface Sessions {
	registrar: string;
	medic: string;
}

// ══════════════════════════════════════════════════════════════════════════════
// Flow A — walk-in
// ══════════════════════════════════════════════════════════════════════════════
async function walkInFlow(browser: Browser, run: Run, s: Sessions) {
	const lastName = `${run.tag}Walkin`;
	const head: Person = {
		firstName: 'Somchai',
		lastName,
		gender: 'male',
		nationalId: makeThaiNationalId(run.seed),
		phone: makePhone(run.seed),
		age: '67',
		vulnerableGroups: ['elderly_dependent']
	};
	const child: Person = {
		firstName: 'Dara',
		lastName,
		gender: 'female',
		nationalId: makeThaiNationalId(run.seed + 7),
		age: '9',
		zone: ZONE_VULNERABLE
	};
	const relative: Person = {
		firstName: 'Malee',
		lastName,
		gender: 'female',
		nationalId: makeThaiNationalId(run.seed + 13),
		age: '41'
	};
	const addressNo = `${99 + run.house}/${SEED % 1000}`;
	const dogName = 'โกโก้';
	const plate = 'กข 1234 สงขลา';
	const valuables = 'เอกสารสำคัญ, เครื่องใช้ไฟฟ้า';

	const desk = await openAsStaff(browser, REGISTRAR, s.registrar);
	const clinic = await openAsStaff(browser, MEDIC, s.medic);
	const ids: Record<string, string> = {};

	// Station 1: search first — unknown ID → new registration
	await test.step('Station 1: search finds nothing → open the walk-in form', async () => {
		await searchStation1(desk, head.nationalId);
		await expect(desk.getByRole('heading', { name: 'ไม่พบรายการ' })).toBeVisible({
			timeout: 15_000
		});
		await desk.getByRole('link', { name: '+ ลงทะเบียนใหม่' }).click();
		await expect(desk).toHaveURL(/\/onsite\/people\/new/);
		await expect(desk.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible();
	});

	// Station 1: new household, 2 members (+ pet / car / assets when enabled)
	await test.step('Station 1: register a NEW household (address, 2 members, pet, vehicle, assets, zone)', async () => {
		await fillAddress(desk, addressNo, 'หมู่ 5');
		await expect(desk.locator('#postal_code')).not.toHaveValue('');

		await fillMemberCard(desk, 0, head);
		await desk.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
		await fillMemberCard(desk, 1, child);

		if (run.flags.pets) {
			const petsTrigger = desk.locator('#unified-pets [data-accordion-trigger]').first();
			if ((await petsTrigger.getAttribute('aria-expanded')) !== 'true') await petsTrigger.click();
			await desk.getByRole('button', { name: 'เพิ่มสุนัข' }).click();
			await desk.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้').fill(dogName);
			await desk.getByText('มีกรง / สายจูง / ตะกร้า').click();
		} else skipped('pets: บันทึกสัตว์เลี้ยงตอนลงทะเบียน is off');

		if (run.flags.vehicles) {
			await desk.getByRole('button', { name: 'เพิ่มยานพาหนะ' }).click();
			await desk.locator('#unified-vehicles input').first().fill(plate);
		} else skipped('vehicles: บันทึกยานพาหนะตอนลงทะเบียน is off');

		if (run.flags.assets) {
			await desk.locator('#family-assets').fill(valuables);
		} else skipped('assets: บันทึกทรัพย์สิน / สัมภาระตอนลงทะเบียน is off');

		await desk.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();
	});

	await test.step('Station 1: batch Person-QR screen lists 2 people; the QRs carry their evacuee ids', async () => {
		Object.assign(ids, await idsFromPrintScreen(desk, [head, child]));
		await finishPrintScreen(desk);
	});

	await test.step('Station 1: statuses and household details as staff see them', async () => {
		await expectStay(desk, head, STATUS.arriving);
		// Zone chosen at registration → active, awaiting arrival.
		await expectStay(desk, child, STATUS.active, ZONE_VULNERABLE);

		await desk.goto(`/onsite/people/evacuee-profile-view/${ids[head.firstName]}`);
		const profile = desk.getByRole('main').last();
		await expect(profile).toContainText(fullName(head), { timeout: 20_000 });
		await expect(profile).toContainText(addressNo);
		if (run.flags.pets) await expect(profile).toContainText(dogName);
		if (run.flags.vehicles) await expect(profile).toContainText(plate);
		if (run.flags.assets) await expect(profile).toContainText('เอกสารสำคัญ');
	});

	// ── Station 1: a relative walks in later and JOINS the existing household ──
	await test.step('Station 1: second walk-in joins the existing household by address', async () => {
		await desk.goto('/onsite/people/new');
		await expect(desk.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible({
			timeout: 20_000
		});
		await fillAddress(desk, addressNo, 'หมู่ 5');
		await expect(desk.getByText('พบครอบครัวที่อยู่ใกล้เคียง')).toBeVisible({ timeout: 15_000 });
		await desk.getByRole('button', { name: 'เข้าร่วม', exact: true }).first().click();
		await expect(desk.getByText('จะเข้าร่วมครอบครัวที่มีอยู่แล้ว')).toBeVisible();

		await fillMemberCard(desk, 0, relative);
		await desk.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();
		Object.assign(ids, await idsFromPrintScreen(desk, [relative]));
		await finishPrintScreen(desk);

		// Same household: the head's profile lists the relative.
		await desk.goto(`/onsite/people/evacuee-profile-view/${ids[head.firstName]}`);
		await expect(desk.getByRole('main').last()).toContainText(relative.firstName, {
			timeout: 20_000
		});
	});

	await test.step('Station 3 queue before Station 2: held back (ON) / listed straight away (OFF)', async () => {
		await expectZoningQueue(desk, run.flags, lastName, [head, relative], { screened: false });
	});

	// ── Station 2: medical screening (head + relative) ──
	await test.step(
		run.flags.medical
			? 'Station 2: doctor screens head and relative'
			: 'Station 2 is switched off: notice shown instead of the screening form',
		async () => {
			if (!run.flags.medical) skipped('Station 2: เปิดคัดกรองการแพทย์ is off');
			await stationTwo(clinic, run.flags, [
				{
					id: ids[head.firstName],
					fill: {
						careTrack: 'fast_track',
						conditions: 'เบาหวาน, ความดันสูง',
						medications: 'เมทฟอร์มิน',
						allergies: 'เพนิซิลลิน'
					}
				},
				{ id: ids[relative.firstName], fill: { conditions: 'ไม่มี' } }
			]);
		}
	);

	// ── Station 3: zone allocation ──
	await test.step('Station 3: head gets a zone (relative zoned along), then household confirms arrival', async () => {
		await expectZoningQueue(desk, run.flags, lastName, [head, relative], { screened: true });
		await desk.goto(`/onsite/zoning/${ids[head.firstName]}`);
		await expect(desk.getByText('Station 3', { exact: true })).toBeVisible({ timeout: 20_000 });
		await desk.locator('div.grid button', { hasText: ZONE_GYM_1 }).first().click();
		// The relative is still waiting → offered as a companion.
		await desk.getByRole('checkbox').first().click();
		await desk.getByRole('button', { name: 'จัดเข้าโซน (รอยืนยันถึงโซน)' }).click();
		await expect(desk).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
		await expectStay(desk, head, STATUS.active, ZONE_GYM_1);
		await expectStay(desk, relative, STATUS.active, ZONE_GYM_1);

		await desk.goto(`/onsite/zoning/${ids[head.firstName]}`);
		// The household button is a silent no-op until the evacuee list has loaded.
		await desk.waitForLoadState('networkidle');
		await desk.getByRole('button', { name: 'ยืนยันทั้งครัวเรือน' }).click();
		await expect(desk.getByText('ยืนยันถึงโซนทั้งครัวเรือน 3 คน')).toBeVisible();
		await expect(desk).toHaveURL(/\/onsite\/zoning$/, { timeout: 20_000 });
		await expectStay(desk, head, STATUS.roomConfirmed, ZONE_GYM_1);
		await expectStay(desk, relative, STATUS.roomConfirmed, ZONE_GYM_1);
		await expectStay(desk, child, STATUS.roomConfirmed, ZONE_VULNERABLE);
	});

	// ── Scan check-out / check-in ──
	await test.step('Scan: check the head OUT, then IN again with the same QR', async () => {
		const others = [relative.firstName, child.firstName];
		await checkOutByScan(desk, ids[head.firstName], others, 'ออกไปธุระนอกพื้นที่');
		await expectStay(desk, head, STATUS.checkedOut);
		await expectStay(desk, relative, STATUS.roomConfirmed);

		await checkInByScan(desk, ids[head.firstName], others, 'Z1');
		await expectStay(desk, head, STATUS.active, ZONE_GYM_1);
	});

	// Cleanup: check everybody out (people cannot be deleted from the UI)
	await test.step('Cleanup: check everyone out through the scan page', async () => {
		const everyone = [head, relative, child];
		for (const p of everyone) {
			const others = everyone.filter((o) => o !== p).map((o) => o.firstName);
			await checkOutByScan(desk, ids[p.firstName], others, 'จบการทดสอบ');
		}
		for (const p of everyone) await expectStay(desk, p, STATUS.checkedOut);
	});

	await desk.context().close();
	await clinic.context().close();
}

// ══════════════════════════════════════════════════════════════════════════════
// Flow B — pre-registration (two screens)
// ══════════════════════════════════════════════════════════════════════════════
async function preRegisterFlow(browser: Browser, run: Run, s: Sessions) {
	const lastName = `${run.tag}Prereg`;
	const viaQueue = !run.flags.preRegistration;
	const familyHead: Person = {
		firstName: 'Prasert',
		lastName,
		gender: 'male',
		nationalId: makeThaiNationalId(run.seed + 101),
		phone: makePhone(run.seed + 101),
		age: '52'
	};
	const familySpouse: Person = {
		firstName: 'Suda',
		lastName,
		gender: 'female',
		nationalId: makeThaiNationalId(run.seed + 103),
		phone: makePhone(run.seed + 103),
		age: '49',
		vulnerableGroups: ['chronic_illness']
	};
	const soloTraveller: Person = {
		firstName: 'Wichai',
		lastName,
		gender: 'male',
		nationalId: makeThaiNationalId(run.seed + 107),
		phone: makePhone(run.seed + 107),
		age: '30'
	};
	const everyone = [familyHead, familySpouse, soloTraveller];

	// Screen A: the public, no login; one tab per registration (the form remembers the shelter per tab).
	const publicCtx = await browser.newContext();
	await publicCtx.addInitScript(() => {
		(window as unknown as { __captchaToken?: string }).__captchaToken = 'e2e-captcha-token';
	});
	const newPublicTab = async () => {
		const tab = await publicCtx.newPage();
		logFailedResponses(tab, 'public');
		return tab;
	};
	// Screen B: the registration desk.
	const screenB = await openAsStaff(browser, REGISTRAR, s.registrar);
	const clinic = await openAsStaff(browser, MEDIC, s.medic);
	const ids: Record<string, string> = {};

	/** Toggle on: public booking for SH001; returns the ticket QR (`evacuee:<head id>`). */
	async function bookShelter(opts: {
		addressNo: string;
		members: Person[];
		pet?: boolean;
	}): Promise<string> {
		const screenA = await newPublicTab();
		// Eventually consistent (sync worker): reload until the page shows the new state.
		await expect(async () => {
			await screenA.goto('/pre-register?shelter=SH001');
			await expect(screenA.locator('#address-no')).toBeVisible({ timeout: 5_000 });
		}).toPass({ timeout: 45_000, intervals: [1_000, 2_000, 3_000] });

		await fillAddress(screenA, opts.addressNo);
		for (const [i, member] of opts.members.entries()) {
			if (i > 0) await screenA.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
			await fillMemberCard(screenA, i, member);
		}
		if (opts.pet) {
			const trigger = screenA.locator('#unified-pets [data-accordion-trigger]').first();
			if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
			await screenA.getByRole('button', { name: 'เพิ่มแมว' }).click();
			await screenA.getByPlaceholder('เช่น ถุงเงิน, เจ้าส้ม, บ๊อบบี้').fill('มะลิ');
			// The consent only shows when the policy lists conditions; if required and missing, submit fails.
			await screenA
				.getByLabel(/ข้าพเจ้ารับทราบและยินยอมปฏิบัติตามเงื่อนไขและมาตรการด้านความปลอดภัย/)
				.check({ timeout: 5_000 })
				.catch(() => {});
		}
		await submitPublicForm(screenA, '/api/public/v1/registrations');

		const qr = screenA.getByAltText('QR สำหรับยืนยันตัวตนที่ประตูศูนย์');
		await expect(qr).toBeVisible({ timeout: 30_000 });
		return decodeQrImage(screenA, qr);
	}

	/**
	 * Toggle off: SH001 refuses booking, so register as "ไม่ระบุศูนย์พักพิง" into the central queue.
	 * Returns the queue registration id (also the ticket QR).
	 */
	async function registerToQueue(opts: { addressNo: string; members: Person[] }): Promise<string> {
		const screenA = await newPublicTab();
		await screenA.goto('/pre-register');
		await expect(
			screenA.getByRole('heading', { name: 'ศูนย์พักพิงที่ต้องการเข้าพัก' })
		).toBeVisible({ timeout: 20_000 });
		// Form body must mount — shelter heading alone survives a UnifiedRegistrationForm crash.
		await expect(screenA.locator('#address-no')).toBeVisible({ timeout: 15_000 });
		await screenA.getByRole('button', { name: /เลือกศูนย์พักพิง|ไม่ระบุศูนย์พักพิง/ }).click();
		// SH001 is no longer offered.
		await expect(
			screenA.getByRole('option', { name: /ศูนย์กีฬามหาวิทยาลัยสงขลานครินทร์/ })
		).toHaveCount(0);
		await screenA.getByRole('option', { name: /ไม่ระบุศูนย์พักพิง/ }).click();

		await fillAddress(screenA, opts.addressNo);
		for (const [i, member] of opts.members.entries()) {
			if (i > 0) await screenA.getByRole('button', { name: 'เพิ่มสมาชิก' }).click();
			await fillMemberCard(screenA, i, member);
		}
		await screenA.getByLabel(/ข้าพเจ้ารับทราบเงื่อนไขการใช้งานระบบ/).check();
		const reply = await submitPublicForm(screenA, '/api/public/v1/unassigned-registrations');

		const id = String(reply.id ?? '');
		expect(id).not.toBe('');
		await expect(screenA.getByText('ลงทะเบียนล่วงหน้าสำเร็จ')).toBeVisible({ timeout: 30_000 });
		const qr = screenA.getByAltText(/คิวกลาง|queue/i);
		await expect(qr).toBeVisible();
		expect(await decodeQrImage(screenA, qr)).toBe(id);
		return id;
	}

	/** Desk side of a queue hit: tick everyone → review → confirm report-in. */
	async function claimQueueHit(people: Person[]): Promise<void> {
		const dialog = screenB.getByRole('dialog', { name: 'เลือกรายการจากคิวกลาง' });
		await expect(dialog).toBeVisible({ timeout: 20_000 });
		const boxes = dialog.getByRole('checkbox');
		await expect(boxes).toHaveCount(people.length);
		for (let i = 0; i < people.length; i++) await boxes.nth(i).click();
		await dialog.getByRole('button', { name: 'ตรวจสอบรายละเอียด →' }).click();
		await expect(screenB).toHaveURL(/\/onsite\/unassigned\/.+\/report-in/, { timeout: 20_000 });
		await expect(screenB.getByRole('heading', { name: 'ตรวจสอบก่อนรับเข้าศูนย์' })).toBeVisible();
		await expect(screenB.locator('#member-0-first-name')).not.toHaveValue('', {
			timeout: 20_000
		});
		await screenB.getByRole('button', { name: 'ยืนยันรายงานตัวและพิมพ์บัตร' }).last().click();
		Object.assign(ids, await idsFromPrintScreen(screenB, people));
		await finishPrintScreen(screenB);
	}

	// ── Screen A: two separate registrations ──
	let familyRef = '';
	let soloRef = '';
	if (!viaQueue) {
		await test.step('Screen A: family of 2 (with a cat when pets are on) pre-registers for SH001 and gets a ticket QR', async () => {
			familyRef = await bookShelter({
				addressNo: `${77 + run.house}/${SEED % 1000}`,
				members: [familyHead, familySpouse],
				pet: run.flags.pets
			});
			expect(familyRef).toMatch(/^evacuee:/);
		});
		await test.step('Screen A: a solo traveller pre-registers too', async () => {
			soloRef = await bookShelter({
				addressNo: `${78 + run.house}/${SEED % 1000}`,
				members: [soloTraveller]
			});
			expect(soloRef).toMatch(/^evacuee:/);
		});
	} else {
		await test.step('Screen A: SH001 refuses public booking (toggle off)', async () => {
			const tab = await newPublicTab();
			// Eventually consistent, see bookShelter.
			await expect(async () => {
				await tab.goto('/pre-register?shelter=SH001');
				await expect(
					tab.getByText('ศูนย์นี้ยังไม่เปิดรับลงทะเบียนล่วงหน้าจากหน้าสาธารณะ').first()
				).toBeVisible({ timeout: 5_000 });
			}).toPass({ timeout: 45_000, intervals: [1_000, 2_000, 3_000] });
			// No form is offered for a shelter that refuses booking.
			await expect(tab.locator('#address-no')).toHaveCount(0);
			skipped('public booking of SH001: รับลงทะเบียนเข้าพักล่วงหน้าจากหน้าสาธารณะ is off');
		});
		await test.step('Screen A: family of 2 registers into the central queue', async () => {
			familyRef = await registerToQueue({
				addressNo: `${77 + run.house}/${SEED % 1000}`,
				members: [familyHead, familySpouse]
			});
		});
		await test.step('Screen A: a solo traveller registers into the central queue too', async () => {
			soloRef = await registerToQueue({
				addressNo: `${78 + run.house}/${SEED % 1000}`,
				members: [soloTraveller]
			});
		});
		await test.step('Nobody is in the shelter yet — the queue lives apart until the desk claims it', async () => {
			await searchStation1(screenB, familyHead.nationalId);
			await expect(screenB.getByRole('heading', { name: 'คิวกลาง' })).toBeVisible({
				timeout: 20_000
			});
			await expect(screenB.getByRole('button', { name: 'รับเข้าศูนย์' }).first()).toBeVisible();
			await expect(screenB.getByRole('heading', { name: 'ในศูนย์นี้' })).toHaveCount(0);
		});
	}

	// ── Screen B: report-in #1 by SEARCH ──
	await test.step(
		viaQueue
			? 'Screen B: search finds the family in the central queue → claim + report-in'
			: 'Screen B: search finds the pre-registered family → report-in',
		async () => {
			// The queue only lists members the query matches: search by family name to claim both.
			await searchStation1(screenB, viaQueue ? lastName : familyHead.nationalId);
			if (viaQueue) {
				await expect(screenB.getByRole('heading', { name: 'คิวกลาง' })).toBeVisible({
					timeout: 20_000
				});
				// Two queue registrations share the name; pick the family's card.
				await screenB
					.locator('li', { hasText: familyHead.firstName })
					.filter({ has: screenB.getByRole('button', { name: 'รับเข้าศูนย์' }) })
					.getByRole('button', { name: 'รับเข้าศูนย์' })
					.click();
				await claimQueueHit([familyHead, familySpouse]);
			} else {
				const hit = screenB.locator('li', { hasText: fullName(familyHead) }).first();
				await expect(hit).toBeVisible({ timeout: 20_000 });
				await expect(hit.getByText('ลงทะเบียนล่วงหน้า')).toBeVisible();
				await hit.getByRole('button', { name: 'รับรายงานตัว (Report-in)' }).click();
				await expect(screenB).toHaveURL(/\/onsite\/people\/.+\/report-in/);
				await expect(screenB.getByRole('heading', { name: 'รายงานตัวผู้ประสบภัย' })).toBeVisible({
					timeout: 20_000
				});
				// Both members arrive pre-filled from the booking.
				await expect(screenB.locator('#member-0-first-name')).toHaveValue(familyHead.firstName, {
					timeout: 20_000
				});
				await expect(screenB.locator('#member-1-first-name')).toHaveValue(familySpouse.firstName);
				// Only the opened person is ticked for this round — tick the spouse too.
				const spouseCard = screenB.locator('#unified-member-1');
				await expect(spouseCard.getByText('ยังไม่เลือก — ไม่มาในรอบนี้')).toBeVisible();
				await spouseCard.getByText('ยังไม่เลือก — ไม่มาในรอบนี้').click();
				await expect(spouseCard.getByText('เลือกแล้ว — รายงานตัวรอบนี้')).toBeVisible();
				await screenB.getByRole('button', { name: 'ยืนยันรายงานตัวและพิมพ์บัตร' }).last().click();
				Object.assign(ids, await idsFromPrintScreen(screenB, [familyHead, familySpouse]));
				await finishPrintScreen(screenB);
				// The ticket QR is the head's Person QR.
				expect(familyRef).toBe(ids[familyHead.firstName]);
			}
		}
	);

	// ── Screen B: report-in #2 by scanning the ticket QR ──
	await test.step(
		viaQueue
			? 'Screen B: scanning the solo queue QR opens the claim dialog'
			: 'Screen B: scanning the solo ticket QR opens report-in directly',
		async () => {
			await scanIntoStation1(screenB, soloRef);
			if (viaQueue) {
				await claimQueueHit([soloTraveller]);
			} else {
				await expect(screenB).toHaveURL(/\/onsite\/people\/.+\/report-in/, { timeout: 20_000 });
				await expect(screenB.locator('#member-0-first-name')).toHaveValue(soloTraveller.firstName, {
					timeout: 20_000
				});
				await screenB.getByRole('button', { name: 'ยืนยันรายงานตัวและพิมพ์บัตร' }).last().click();
				Object.assign(ids, await idsFromPrintScreen(screenB, [soloTraveller]));
				await finishPrintScreen(screenB);
				expect(soloRef).toBe(ids[soloTraveller.firstName]);
			}
		}
	);

	await test.step('Reported in: everyone is now waiting at the shelter', async () => {
		for (const p of everyone) await expectStay(screenB, p, STATUS.arriving);
	});

	await test.step('Station 3 queue before Station 2: held back (ON) / listed straight away (OFF)', async () => {
		await expectZoningQueue(screenB, run.flags, lastName, everyone, { screened: false });
	});

	// ── Station 2 ──
	await test.step(
		run.flags.medical
			? 'Station 2: screening — spouse has an EWAR symptom'
			: 'Station 2 is switched off: notice shown instead of the screening form',
		async () => {
			if (!run.flags.medical) skipped('Station 2: เปิดคัดกรองการแพทย์ is off');
			await stationTwo(clinic, run.flags, [
				{ id: ids[familyHead.firstName], fill: { conditions: 'ไม่มี' } },
				{
					id: ids[familySpouse.firstName],
					fill: {
						conditions: 'โรคหอบหืด',
						notes: 'ไอ มีไข้ต่ำ',
						ewarSymptoms: [/ติดเชื้อทางเดินหายใจเฉียบพลัน/]
					}
				},
				{ id: ids[soloTraveller.firstName], fill: { conditions: 'ไม่มี' } }
			]);
		}
	);

	// ── Station 3 ──
	await test.step('Station 3: head → Z1, spouse (EWAR-flagged when Station 2 is on) → Z2, solo → Z3, then confirm arrival', async () => {
		await expectZoningQueue(screenB, run.flags, lastName, everyone, { screened: true });
		await assignZone(screenB, ids[familyHead.firstName], ZONE_GYM_1);
		if (run.flags.medical) {
			await screenB.goto(`/onsite/zoning/${ids[familySpouse.firstName]}`);
			await expect(screenB.getByText(/เฝ้าระวัง EWAR \(1 อาการ\)/)).toBeVisible({
				timeout: 20_000
			});
		}
		await assignZone(screenB, ids[familySpouse.firstName], ZONE_GYM_2);
		await assignZone(screenB, ids[soloTraveller.firstName], ZONE_VULNERABLE);
		await expectStay(screenB, familyHead, STATUS.active, ZONE_GYM_1);
		await expectStay(screenB, familySpouse, STATUS.active, ZONE_GYM_2);
		await expectStay(screenB, soloTraveller, STATUS.active, ZONE_VULNERABLE);

		for (const p of everyone) await confirmArrivalInZone(screenB, ids[p.firstName]);
		await expectStay(screenB, familyHead, STATUS.roomConfirmed, ZONE_GYM_1);
		await expectStay(screenB, familySpouse, STATUS.roomConfirmed, ZONE_GYM_2);
		await expectStay(screenB, soloTraveller, STATUS.roomConfirmed, ZONE_VULNERABLE);
	});

	// Scan check-out by QR (== evacuee id)
	await test.step('Scan: the solo traveller checks out by QR', async () => {
		await checkOutByScan(screenB, ids[soloTraveller.firstName], [], 'เดินทางกลับบ้าน');
		await expectStay(screenB, soloTraveller, STATUS.checkedOut);
	});

	// Cleanup: check the family out too
	await test.step('Cleanup: check the family out through the scan page', async () => {
		await checkOutByScan(
			screenB,
			ids[familyHead.firstName],
			[familySpouse.firstName],
			'จบการทดสอบ'
		);
		await checkOutByScan(
			screenB,
			ids[familySpouse.firstName],
			[familyHead.firstName],
			'จบการทดสอบ'
		);
		await expectStay(screenB, familyHead, STATUS.checkedOut);
		await expectStay(screenB, familySpouse, STATUS.checkedOut);
	});

	await publicCtx.close();
	await screenB.context().close();
	await clinic.context().close();
}

// ══════════════════════════════════════════════════════════════════════════════
// Suite
// ══════════════════════════════════════════════════════════════════════════════
test.describe(
	'Registration stations 1 → 3 (real stack, via UI)',
	{ tag: ['@onsite', '@quarantine'] },
	() => {
		let sessions: Sessions;
		let adminSession: string;
		/** As found; put back in afterAll. */
		let originalToggles: Toggles;
		let recaptchaWasEnabled = true;

		test.beforeAll(async ({ browser }) => {
			test.setTimeout(180_000);
			await createStaffUser(REGISTRAR);
			await createStaffUser(MEDIC);
			await createStaffUser(ADMIN);
			sessions = {
				registrar: await couchLogin(REGISTRAR.name, REGISTRAR.password),
				medic: await couchLogin(MEDIC.name, MEDIC.password)
			};
			adminSession = await couchLogin(ADMIN.name, ADMIN.password);

			// No human submits the public form: switch the CAPTCHA off for the run.
			const admin = await openAsStaff(browser, ADMIN, adminSession);
			recaptchaWasEnabled = await setRecaptcha(admin, false);
			await admin.context().close();

			const manager = await openAsStaff(browser, MEDIC, sessions.medic);
			originalToggles = await readToggles(manager);
			await manager.context().close();
		});

		test.afterAll(async ({ browser }) => {
			test.setTimeout(180_000);
			if (sessions?.medic && originalToggles) {
				try {
					const manager = await openAsStaff(browser, MEDIC, sessions.medic);
					await waitForSyncWorker(manager);
					await setToggles(manager, originalToggles);
					await waitForSyncWorker(manager);
					await manager.context().close();
				} catch (err) {
					console.error('Failed to restore shelter toggles:', err);
				}
			}
			if (adminSession) {
				try {
					const admin = await openAsStaff(browser, ADMIN, adminSession);
					await setRecaptcha(admin, recaptchaWasEnabled);
					await admin.context().close();
				} catch (err) {
					console.error('Failed to restore recaptcha:', err);
				}
			}
			try {
				console.log(`Deleted ${await deleteRunData()} docs created by run ${RUN_TAG}`);
			} catch (err) {
				console.error(`Failed to delete test data (tag ${RUN_TAG}):`, err);
			}
			await Promise.allSettled([
				deleteCouchUser(REGISTRAR.name),
				deleteCouchUser(MEDIC.name),
				deleteCouchUser(ADMIN.name)
			]);
		});

		test.beforeEach(() => {
			test.info().annotations.push({ type: 'test data tag', description: RUN_TAG });
		});

		async function applyToggles(browser: Browser, run: Run, target: Partial<Toggles>) {
			const manager = await openAsStaff(browser, MEDIC, sessions.medic);
			run.flags = await setToggles(manager, target);
			await waitForSyncWorker(manager);
			await manager.context().close();
		}

		test.describe('SH001 all switches ON', () => {
			test.beforeAll(async ({ browser }) => {
				test.setTimeout(180_000);
				await applyToggles(browser, ON, ON_TARGET);
			});

			test('1.1 walk-in: Station 1 (new + joined household, pet, vehicle, assets) → Station 2 → Station 3 → scan check-out/in', async ({
				browser
			}) => {
				test.setTimeout(300_000);
				await walkInFlow(browser, ON, sessions);
			});

			test('1.2 pre-register: public site (screen A) → report-in at the desk by search + QR scan (screen B) → Station 2 → Station 3', async ({
				browser
			}) => {
				test.setTimeout(420_000);
				await preRegisterFlow(browser, ON, sessions);
			});
		});

		test.describe('SH001 pre-registration + Station 2 OFF', () => {
			test.beforeAll(async ({ browser }) => {
				test.setTimeout(180_000);
				await applyToggles(browser, OFF, OFF_TARGET);
			});

			test('1.3 walk-in [switches off]: Station 2 skipped → Station 3 → scan check-out/in', async ({
				browser
			}) => {
				test.setTimeout(300_000);
				await walkInFlow(browser, OFF, sessions);
			});

			test('1.4 pre-register [switches off]: public booking refused → central queue (screen A) → claim by search + QR scan (screen B) → Station 3', async ({
				browser
			}) => {
				test.setTimeout(420_000);
				await preRegisterFlow(browser, OFF, sessions);
			});
		});
	}
);
