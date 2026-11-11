/**
 * CR-233 / issue #1156 — Person QR rotates on every print; the previous QR expires.
 *
 * Covers AC-EQR-12 (print / reprint twice → the older QR is refused on the staff scan page and at
 * the kiosk, the newest one is accepted), AC-EQR-4 (opening the print modal and closing it without
 * printing writes no `evacuee_qr` and the old QR still scans) and AC-EQR-8 (a legacy `evacuee:{ULID}`
 * QR with no `@` stays valid while the evacuee has no print log). #1301: a fast-track screening makes
 * the profile flag the printed card as outdated, and the next print logs `marker: 'red'` (schema_v 2).
 *
 * One serial suite on its own `E2E` shelter (never SH001): the CouchDB server admin provisions the
 * shelter through the staff UI, one kiosk device through the device API and two staff accounts
 * (registration_staff, kitchen_staff) through CouchDB `_users`. Station 1 registers one evacuee
 * through the UI. Then:
 *   - staff: the evacuee-qr modal prints twice (the PDF button issues a QR without a printer);
 *     the issue endpoint's response carries each payload
 *   - staff scan page `/onsite/scan-check-in-out`: old QR → message with dates and no profile
 *   - kiosk: `/api/v1/kiosk/lookup` (409 KIOSK_QR_EXPIRED) and `/api/v1/kiosk/reprint` (a fresh QR
 *     that expires the staff one). Kiosk hardware itself is out of scope: device id + secret only.
 *   - RBAC: the issue endpoint refuses kitchen_staff (403) and allows registration_staff.
 *
 * Data safety: the device is deleted in afterAll, the shelter (and with it its `evacuee_qr` log —
 * the validate_doc_update forbids deleting those docs even for the server admin, so the whole
 * database goes) by `teardownShelter`; both accounts are removed. Names carry `E2E` + the run id.
 *
 * Tags: `@onsite` + `@kiosk` + `@critical`. Runs locally, or on a remote target with
 * `ALLOW_REMOTE_WRITES=true`; skipped (read-only) otherwise.
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, then
 *   PUBLIC_COUCH_PROXY=/couch pnpm exec vite build --mode test
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4191 pnpm exec playwright test e2e/evacuee-qr-rotate.test.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
	bootstrapAdminSession,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	getDocument,
	putDocument,
	registrationStaffRoles,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { acceptFullConsent } from './helpers/consent';
import { appBaseUrl, CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	fillMemberCard,
	fillWalkInAddress,
	finishPrintScreen,
	fullName,
	evacueeIdsFromSearch,
	expectPrintScreen,
	openAsShelterStaff,
	submitScan,
	type OnsitePerson
} from './helpers/onsite';
import { fictitiousNationalId, fictitiousPhone } from './helpers/pre-register';
import { purgeCreatedData, recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

/** Id of this spec's created-data ledger (see helpers/public-cleanup.ts). */
const LEDGER_SUITE = 'evacuee-qr-rotate';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const PASSWORD = 'Password1!';
const MARKER = `E2E QR ${RUN_ID}`;
const DEVICE_ID = `e2e-qr-${RUN_ID}`;
const LAST_NAME = `QrRotate${RUN_ID}`;
const NATIONAL_ID = fictitiousNationalId((Number.parseInt(RUN_ID, 36) + 7) % 1e11);
const PHONE = fictitiousPhone();

const PERSON: OnsitePerson = {
	firstName: 'Somying',
	lastName: LAST_NAME,
	gender: 'female',
	nationalId: NATIONAL_ID,
	phone: PHONE,
	age: '39'
};

const EXPIRED_WITH_DATES = /QR นี้ออกวันที่ .+ มีใบใหม่วันที่ .+/;
const EXPIRED_LEGACY = /QR นี้ออกก่อนเปลี่ยนระบบ มีใบใหม่วันที่ .+/;

let shelterCode: string | undefined;
let adminCookie = '';
let deviceSecret = '';
let registrar: TestUser | undefined;
let cook: TestUser | undefined;
let registrarSession = '';
let cookSession = '';
let evacueeId = ''; // evacuee:{ULID}
let liveWritesStarted = false;
let desk: Page | undefined;

/** The payloads issued so far, oldest first (qr[0] was printed first). */
const issued: string[] = [];

const shelterDb = () => `shelter_${shelterCode!.toLowerCase()}`;
const qrDocId = () => `evacuee_qr:${evacueeId.slice('evacuee:'.length)}`;

type QrLog = {
	schema_v: number;
	prints: {
		printed_at: string;
		hash: string;
		source: string;
		printed_by: string;
		marker?: 'red' | 'yellow' | null;
	}[];
};
const readLog = async () => (await getDocument(shelterDb(), qrDocId())) as QrLog | null;

/** One call to the app's own BFF with a session cookie (no browser involved). */
async function bff(
	cookie: string,
	method: string,
	path: string,
	body?: unknown
): Promise<{ status: number; data: unknown }> {
	const res = await fetch(`${appBaseUrl()}${path}`, {
		method,
		headers: { Cookie: `AuthSession=${cookie}`, 'Content-Type': 'application/json' },
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: res.status, data: await res.json().catch(() => null) };
}

/** One kiosk-device call: device id + secret, no staff session. */
type KioskBody = {
	error?: { code: string; issued_at?: string | null; current_printed_at?: string };
	members?: { evacuee_id: string; qr_payload?: string }[];
} | null;

async function kiosk(path: string, body: unknown): Promise<{ status: number; data: KioskBody }> {
	const res = await fetch(`${appBaseUrl()}${path}`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-device-id': DEVICE_ID,
			'x-device-secret': deviceSecret
		},
		body: JSON.stringify(body)
	});
	return { status: res.status, data: (await res.json().catch(() => null)) as KioskBody };
}

const kioskLookup = (token: string) => kiosk('/api/v1/kiosk/lookup', { source: 'qr', token });

async function createStaff(name: string, roles: string[], display: string): Promise<TestUser> {
	const user: TestUser = { name, password: PASSWORD, roles, display_name: display };
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return user;
}

/** Click "พิมพ์บัตรประจำตัว" in the open modal and return the QR the issue endpoint answered with. */
async function printViaModal(page: Page): Promise<string> {
	const issueResponse = page.waitForResponse(
		(r) => r.url().includes('/api/v1/evacuee-qr/issue') && r.request().method() === 'POST'
	);
	const popup = page.waitForEvent('popup', { timeout: 15_000 }).catch(() => null);
	await page.getByRole('button', { name: 'พิมพ์บัตรประจำตัว' }).click();
	const res = await issueResponse;
	expect(res.status()).toBe(200);
	const body = (await res.json()) as {
		items: { evacuee_id: string; status: string; qr_payload?: string }[];
	};
	expect(body.items).toHaveLength(1);
	expect(body.items[0]).toMatchObject({ evacuee_id: evacueeId, status: 'issued' });
	await (await popup)?.close().catch(() => undefined);
	// The button is re-enabled once the PDF round trip is over.
	await expect(page.getByRole('button', { name: 'พิมพ์บัตรประจำตัว' })).toBeEnabled({
		timeout: 15_000
	});
	return body.items[0].qr_payload!;
}

async function openQrModal(page: Page): Promise<void> {
	await page.goto(`/onsite/people/evacuee-profile-view/${encodeURIComponent(evacueeId)}`);
	await page
		.getByRole('button', { name: 'พิมพ์ QR' })
		.filter({ visible: true })
		.first()
		.click({ timeout: 30_000 });
	await expect(page.getByRole('dialog', { name: /บัตรประจำตัวผู้ประสบภัย/ })).toBeVisible();
	await expect(page.getByRole('button', { name: 'พิมพ์บัตรประจำตัว' })).toBeEnabled({
		timeout: 15_000
	});
}

/** The staff scan page refused the code: dates in the message, and no profile card opened. */
async function expectScanRejected(page: Page, payload: string, message: RegExp): Promise<void> {
	await submitScan(page, payload);
	await expect(page.getByText(message).first()).toBeVisible({ timeout: 20_000 });
	await expect(page.getByRole('heading', { name: fullName(PERSON) })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'เช็คอิน', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'เช็คเอาต์', exact: true })).toHaveCount(0);
}

/** The staff scan page opened the evacuee's profile card. */
async function expectScanAccepted(page: Page, payload: string): Promise<void> {
	await submitScan(page, payload);
	await expect(page.getByRole('heading', { name: fullName(PERSON) })).toBeVisible({
		timeout: 20_000
	});
	await expect(page.getByText(/QR นี้ออก|QR ไม่ถูกต้อง/)).toHaveCount(0);
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	await desk?.context().close();
	if (shelterCode) {
		await bff(adminCookie, 'DELETE', `/api/v1/kiosk/devices/${DEVICE_ID}`).catch(() => undefined);
		await teardownShelter(shelterCode).catch(() => undefined);
		shelterCode = undefined;
	}
	await purgeCreatedData(LEDGER_SUITE, LAST_NAME);
	if (registrar) await deleteCouchUser(registrar.name).catch(() => undefined);
	if (cook) await deleteCouchUser(cook.name).catch(() => undefined);
});

test.describe(
	'Person QR rotates on every print and the previous QR expires (CR-233)',
	{ tag: ['@onsite', '@kiosk', '@critical'] },
	() => {
		// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
		test.beforeEach(({}, testInfo) => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.skip(
				!shelterCode && !testInfo.title.startsWith('arrange'),
				'no E2E shelter this run (arrange failed)'
			);
		});

		test('arrange: an E2E shelter with a kiosk device, two staff accounts and one evacuee', async ({
			page,
			browser
		}: {
			page: Page;
			browser: Browser;
		}) => {
			test.setTimeout(300_000);
			liveWritesStarted = true;
			const admin = await bootstrapAdminSession();
			adminCookie = admin.cookie;
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			shelterCode = await createShelterViaUi(page, {
				name: `${MARKER} ศูนย์ทดสอบ QR`,
				siteKind: 'evacuation_center',
				lat: 7.006,
				lng: 100.498,
				subdistrict: 'คอหงส์',
				capacity: 40
			});
			recordCreatedShelter(shelterCode, LEDGER_SUITE);

			// The kiosk reprint route is closed unless the shelter turned the phone menu on.
			const phoneMenu = page.locator('#kiosk-phone-check-in');
			await expect(phoneMenu).toBeVisible({ timeout: 20_000 });
			if ((await phoneMenu.getAttribute('aria-checked')) !== 'true') await phoneMenu.click();
			await expect(phoneMenu).toHaveAttribute('aria-checked', 'true');
			await page.getByRole('button', { name: 'บันทึกข้อมูล' }).first().click();
			await expect(
				page.getByText(`อัปเดตข้อมูลศูนย์พักพิง ${shelterCode} สำเร็จ`).first()
			).toBeVisible({ timeout: 20_000 });

			const device = await bff(adminCookie, 'POST', '/api/v1/kiosk/devices', {
				device_id: DEVICE_ID,
				name: `${MARKER} ตู้ทดสอบ`,
				shelter_code: shelterCode
			});
			expect(device.status, 'device create').toBe(201);
			deviceSecret = (device.data as { plaintext_secret: string }).plaintext_secret;

			registrar = await createStaff(
				`qr_reg_${RUN_ID}`,
				registrationStaffRoles(shelterCode),
				`${MARKER} registrar`
			);
			cook = await createStaff(
				`qr_cook_${RUN_ID}`,
				[`shelter:${shelterCode}`, `${shelterCode}:kitchen_staff`],
				`${MARKER} cook`
			);
			registrarSession = await couchLogin(registrar.name, registrar.password);
			cookSession = await couchLogin(cook.name, cook.password);

			// Station 1: register one evacuee through the UI.
			desk = await openAsShelterStaff(browser, registrar, registrarSession, shelterCode);
			await desk.goto('/onsite/people/new');
			await expect(desk.getByRole('heading', { name: 'ลงทะเบียนครอบครัว' })).toBeVisible({
				timeout: 20_000
			});
			await fillWalkInAddress(desk, `77/${RUN_ID.slice(-4) || '1'}`, 'หมู่ 1');
			await expect(desk.locator('#postal_code')).not.toHaveValue('');
			await fillMemberCard(desk, 0, PERSON);
			await acceptFullConsent(desk);
			await desk.getByRole('button', { name: 'บันทึกลงทะเบียนทั้งครอบครัว' }).last().click();
			const confirmNew = desk.getByRole('alertdialog').getByRole('button', {
				name: 'ยืนยันลงทะเบียนใหม่',
				exact: true
			});
			const printHeading = desk.getByRole('heading', { name: 'ลงทะเบียนสำเร็จ' });
			await expect(confirmNew.or(printHeading)).toBeVisible({ timeout: 30_000 });
			if (await confirmNew.isVisible()) await confirmNew.click();

			await expectPrintScreen(desk, [PERSON]);
			await finishPrintScreen(desk);
			evacueeId = (await evacueeIdsFromSearch(desk, [PERSON]))[PERSON.firstName];
		});

		test('AC-EQR-4/8: opening the modal and closing it prints nothing; the legacy QR still scans', async () => {
			test.setTimeout(120_000);
			const page = desk!;
			await openQrModal(page);
			// The preview is a placeholder: nothing was issued by opening it.
			expect(await readLog()).toBeNull();
			await page
				.getByRole('dialog', { name: /บัตรประจำตัวผู้ประสบภัย/ })
				.getByRole('button', { name: 'ปิด' })
				.last()
				.click();
			await expect(page.getByRole('dialog', { name: /บัตรประจำตัวผู้ประสบภัย/ })).toHaveCount(0);
			expect(await readLog(), 'closing without print must not write evacuee_qr').toBeNull();

			// AC-EQR-8: no log yet, so the pre-CR-233 payload (no `@`) is still valid, on both surfaces.
			await expectScanAccepted(page, evacueeId);
			const legacy = await kioskLookup(evacueeId);
			expect(legacy.status).toBe(200);
			expect(legacy.data?.error).toBeUndefined();
			expect(await readLog(), 'a scan must not write evacuee_qr').toBeNull();
		});

		test('AC-EQR-12 staff: printing twice expires the older QR on the scan page and at the kiosk', async () => {
			test.setTimeout(240_000);
			const page = desk!;
			await openQrModal(page);

			const first = await printViaModal(page);
			const second = await printViaModal(page);
			issued.push(first, second);
			expect(first).toMatch(new RegExp(`^${evacueeId}@[0-9a-f]{6}$`));
			expect(second).toMatch(new RegExp(`^${evacueeId}@[0-9a-f]{6}$`));
			expect(second).not.toBe(first);

			const log = await readLog();
			expect(log?.prints.map((p) => `${evacueeId}@${p.hash}`)).toEqual([first, second]);
			expect(log?.prints.every((p) => p.source === 'profile')).toBe(true);
			expect(log?.prints.every((p) => p.printed_by === registrar!.name)).toBe(true);

			// Staff scan page: the first print is superseded, the second is the live one.
			await expectScanRejected(page, first, EXPIRED_WITH_DATES);
			await expectScanAccepted(page, second);
			// ... and so is the legacy payload now that a log exists.
			await expectScanRejected(page, evacueeId, EXPIRED_LEGACY);

			// Kiosk lookup: 409 KIOSK_QR_EXPIRED with dates only, no household data.
			const stale = await kioskLookup(first);
			expect(stale.status).toBe(409);
			expect(stale.data!.error).toMatchObject({ code: 'KIOSK_QR_EXPIRED' });
			expect(stale.data!.error!.issued_at).toBe(log!.prints[0].printed_at);
			expect(stale.data!.error!.current_printed_at).toBe(log!.prints[1].printed_at);
			expect(Object.keys(stale.data!)).toEqual(['error']);
			const live = await kioskLookup(second);
			expect(live.status).toBe(200);
			expect(live.data?.error).toBeUndefined();
			const bare = await kioskLookup(evacueeId);
			expect(bare.status).toBe(409);
			expect(bare.data!.error).toMatchObject({ code: 'KIOSK_QR_EXPIRED', issued_at: null });
		});

		test('AC-EQR-12 kiosk: a kiosk reprint issues a new QR and expires the staff one', async () => {
			test.setTimeout(120_000);
			const page = desk!;
			const reprint = await kiosk('/api/v1/kiosk/reprint', {
				phone: PHONE,
				primary_evacuee_id: evacueeId,
				evacuee_ids: [evacueeId],
				id_last4: NATIONAL_ID.slice(-4)
			});
			expect(reprint.status).toBe(200);
			const members = reprint.data!.members!;
			expect(members).toHaveLength(1);
			const third = members[0].qr_payload!;
			expect(third).toMatch(new RegExp(`^${evacueeId}@[0-9a-f]{6}$`));
			expect(issued).not.toContain(third);
			issued.push(third);

			const log = await readLog();
			expect(log?.prints).toHaveLength(3);
			expect(log?.prints[2]).toMatchObject({ source: 'kiosk_reprint' });
			expect(`${evacueeId}@${log!.prints[2].hash}`).toBe(third);

			// The staff print is now the old one, on both surfaces.
			const stale = await kioskLookup(issued[1]);
			expect(stale.status).toBe(409);
			expect(stale.data!.error!.code).toBe('KIOSK_QR_EXPIRED');
			await expectScanRejected(page, issued[1], EXPIRED_WITH_DATES);
			const live = await kioskLookup(third);
			expect(live.status).toBe(200);
			expect(live.data?.error).toBeUndefined();
			await expectScanAccepted(page, third);

			// A reprint without the right last four digits issues nothing.
			const wrong = await kiosk('/api/v1/kiosk/reprint', {
				phone: PHONE,
				primary_evacuee_id: evacueeId,
				evacuee_ids: [evacueeId],
				id_last4: NATIONAL_ID.slice(-4) === '0000' ? '1111' : '0000'
			});
			expect(wrong.status).toBe(403);
			expect((await readLog())?.prints).toHaveLength(3);
		});

		test('RBAC: the issue endpoint refuses kitchen_staff and a body that names another shelter', async () => {
			const body = { shelter_code: shelterCode, source: 'profile', evacuee_ids: [evacueeId] };
			const denied = await bff(cookSession, 'POST', '/api/v1/evacuee-qr/issue', body);
			expect(denied.status).toBe(403);
			const otherShelter = await bff(registrarSession, 'POST', '/api/v1/evacuee-qr/issue', {
				...body,
				shelter_code: 'SH001'
			});
			expect(otherShelter.status).toBe(403);
			const anonymous = await fetch(`${appBaseUrl()}/api/v1/evacuee-qr/issue`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			expect(anonymous.status).toBe(401);
			// Nothing was written by any refused call.
			expect((await readLog())?.prints).toHaveLength(3);
		});

		test('#1301: a fast-track screening flags the card as outdated; the next print logs marker red', async () => {
			test.setTimeout(180_000);
			const page = desk!;
			const before = await readLog();
			expect(before?.prints.every((p) => (p.marker ?? null) === null)).toBe(true);

			// Station 2 outcome, written straight to the shelter DB: the latest screening is fast track.
			const at = new Date().toISOString();
			await putDocument(shelterDb(), {
				_id: `screening:${evacueeId.slice('evacuee:'.length)}`,
				type: 'screening',
				schema_v: 2,
				shelter_code: shelterCode,
				created_at: at,
				updated_at: at,
				created_by: registrar!.name,
				evacuee_id: evacueeId,
				symptoms: [],
				track: 'fast_track',
				screened_at: at
			});

			// FR-EQR-57: the last print carried no level, so the profile asks for a reprint.
			const stale = page.getByText('บัตรล้าสมัย — ระดับความเปราะบางเปลี่ยน');
			await openQrModal(page);
			await expect(stale).toBeVisible({ timeout: 20_000 });
			const payload = await printViaModal(page);
			expect(issued).not.toContain(payload);
			issued.push(payload);

			const log = await readLog();
			expect(log?.schema_v).toBe(2);
			expect(log?.prints).toHaveLength(before!.prints.length + 1);
			expect(log?.prints.at(-1)).toMatchObject({ source: 'profile', marker: 'red' });
			expect(`${evacueeId}@${log!.prints.at(-1)!.hash}`).toBe(payload);
			// Older entries are never rewritten.
			expect(log?.prints.slice(0, -1)).toEqual(before!.prints);

			await page.goto(`/onsite/people/evacuee-profile-view/${encodeURIComponent(evacueeId)}`);
			await expect(page.getByRole('heading', { name: fullName(PERSON) }).first()).toBeVisible({
				timeout: 30_000
			});
			await expect(stale).toHaveCount(0);
		});

		test('Z teardown leaves no E2E shelter, device or staff of this run', async () => {
			test.setTimeout(240_000);
			await desk?.context().close();
			desk = undefined;
			await bff(adminCookie, 'DELETE', `/api/v1/kiosk/devices/${DEVICE_ID}`).catch(() => undefined);
			const code = shelterCode;
			const created = await purgeCreatedData(LEDGER_SUITE, LAST_NAME);
			if (code && !created.shelters.includes(code)) {
				await teardownShelter(code);
				created.shelters.push(code);
			}
			shelterCode = undefined;

			for (const c of created.shelters) {
				// Dropping the database removes its evacuee_qr log with it.
				expect((await couchReq('GET', `/shelter_${c.toLowerCase()}`)).status).toBe(404);
				const byCode = await couchReq(
					'GET',
					`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(c))}`
				);
				expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
			}
			if (registrar) {
				await deleteCouchUser(registrar.name);
				registrar = undefined;
			}
			if (cook) {
				await deleteCouchUser(cook.name);
				cook = undefined;
			}
		});
	}
);
