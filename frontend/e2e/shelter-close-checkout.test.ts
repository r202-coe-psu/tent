/**
 * Shelter close → check everyone out (CR-219, #986) on an own `E2E` shelter.
 *
 * People are seeded straight into the run's shelter DB (admin `_bulk_docs`) — the
 * close flow only reads stay statuses, and registering six people through the
 * stations would add minutes without testing anything here. Everything the CR is
 * about goes through the real app: the BFF close route, the confirm modal, the
 * PATCH block and reopening.
 *
 * Proves: FR-7 preview counts · FR-8/FR-17 confirm text (modal + server 400) ·
 * FR-18 cancel writes nothing · FR-10/FR-4/FR-5/FR-6/FR-6a writes · FR-12 re-run ·
 * FR-13 registry closed only after the people · FR-22 403 / PATCH 400 · FR-25 reopen.
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, then
 *   pnpm exec playwright test e2e/shelter-close-checkout.test.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
	APP_BASE_URL,
	bootstrapAdminSession,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	registrationStaffRoles,
	seedSecurityQuestion,
	shelterManagerRoles,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { openAsShelterStaff } from './helpers/onsite';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

const LEDGER_SUITE = 'shelter-close-checkout';
const SHELTER_NAME = `E2E ปิดศูนย์ ${RUN_ID}`;

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

type Role = 'manager' | 'staff' | 'otherManager';

let shelterCode: string | undefined;
let liveWritesStarted = false;
const users = new Map<Role, TestUser>();
const sessions = new Map<Role, string>();

type Doc = Record<string, unknown> & { _id: string; _rev?: string };

const db = () => `shelter_${shelterCode!.toLowerCase()}`;
const confirmPhrase = () => `${shelterCode} ${SHELTER_NAME}`;

/** Seeded people: id → stay status before the close. */
const SEED: { id: string; household: string | null; status: string }[] = [
	{ id: 'evacuee:E2ECLOSE01', household: 'household:E2ECLOSEH1', status: 'active' },
	{ id: 'evacuee:E2ECLOSE02', household: 'household:E2ECLOSEH1', status: 'temporary_leave' },
	{ id: 'evacuee:E2ECLOSE03', household: 'household:E2ECLOSEH2', status: 'pre_registered' },
	{ id: 'evacuee:E2ECLOSE04', household: 'household:E2ECLOSEH2', status: 'pre_registered' },
	{ id: 'evacuee:E2ECLOSE05', household: 'household:E2ECLOSEH3', status: 'pre_registered' },
	{ id: 'evacuee:E2ECLOSE06', household: 'household:E2ECLOSEH3', status: 'arriving' },
	{ id: 'evacuee:E2ECLOSE07', household: null, status: 'checked_out' }
];
const HOUSEHOLDS: Record<string, string> = {
	'household:E2ECLOSEH1': 'checked_in',
	'household:E2ECLOSEH2': 'pre_registered',
	'household:E2ECLOSEH3': 'arriving'
};

function envelope(id: string, type: string): Doc {
	const ts = '2026-10-01T00:00:00.000Z';
	return {
		_id: id,
		type,
		schema_v: 5,
		shelter_code: shelterCode!,
		created_at: ts,
		updated_at: ts,
		created_by: 'e2e-seed'
	};
}

async function seedPeople(): Promise<void> {
	const docs: Doc[] = [
		...Object.entries(HOUSEHOLDS).map(([id, status]) => ({
			...envelope(id, 'household'),
			label: `E2E ครัวเรือน ${id.slice(-2)}`,
			status,
			checkout_destination: null
		})),
		...SEED.map((p, i) => ({
			...envelope(p.id, 'evacuee'),
			household_id: p.household,
			first_name: `E2E${i + 1}`,
			last_name: `ปิดศูนย์${RUN_ID}`,
			current_stay: { status: p.status, zone: null, since: '2026-10-01T00:00:00.000Z' }
		}))
	];
	const res = await couchReq('POST', `/${db()}/_bulk_docs`, { docs });
	expect(res.status).toBe(201);
	expect((res.data as { ok?: boolean }[]).every((r) => r.ok)).toBe(true);
}

async function docsOfType(type: string): Promise<Doc[]> {
	const res = await couchReq(
		'GET',
		`/${db()}/_all_docs?include_docs=true&startkey=${encodeURIComponent(`"${type}:"`)}&endkey=${encodeURIComponent(`"${type}:￰"`)}`
	);
	return ((res.data as { rows: { doc: Doc }[] }).rows ?? []).map((r) => r.doc);
}

async function stays(): Promise<Record<string, string>> {
	const evacuees = await docsOfType('evacuee');
	return Object.fromEntries(
		evacuees.map((e) => [e._id, (e.current_stay as { status: string }).status])
	);
}

async function registryStatus(): Promise<{ operation_status?: string; closed_at?: string }> {
	const res = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?include_docs=true&key=${encodeURIComponent(JSON.stringify(shelterCode))}`
	);
	return (res.data as { rows: { doc: Record<string, string> }[] }).rows[0].doc;
}

/** Call the app's BFF as `role` (cookie auth, same as the browser). */
async function api(role: Role, method: string, path: string, body?: unknown) {
	const res = await fetch(`${APP_BASE_URL}${path}`, {
		method,
		headers: {
			Cookie: `AuthSession=${sessions.get(role)}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { status: res.status, data: (await res.json().catch(() => null)) as unknown };
}

async function ensureUsers(code: string): Promise<void> {
	if (sessions.size > 0) return;
	users.set('manager', {
		name: `close_mgr_${RUN_ID}`,
		password: 'Password1!',
		roles: shelterManagerRoles(code),
		display_name: `E2E Close Manager ${RUN_ID}`
	});
	users.set('staff', {
		name: `close_staff_${RUN_ID}`,
		password: 'Password1!',
		roles: registrationStaffRoles(code),
		display_name: `E2E Close Staff ${RUN_ID}`
	});
	users.set('otherManager', {
		name: `close_other_${RUN_ID}`,
		password: 'Password1!',
		roles: shelterManagerRoles('SH001'),
		display_name: `E2E Other Manager ${RUN_ID}`
	});
	for (const [role, user] of users) {
		await createCouchUser(user);
		await seedSecurityQuestion(user.name);
		sessions.set(role, await couchLogin(user.name, user.password));
	}
}

async function openEditAsManager(browser: Browser): Promise<Page> {
	const page = await openAsShelterStaff(
		browser,
		users.get('manager')!,
		sessions.get('manager')!,
		shelterCode!
	);
	await page.goto(`/back-office/shelters/edit/${shelterCode}`);
	await expect(
		page.getByRole('button', { name: 'สถานะการปฏิบัติการ (Operating Status)' })
	).toBeVisible({ timeout: 30_000 });
	return page;
}

async function pickStatus(page: Page, label: string): Promise<void> {
	await page.getByRole('button', { name: 'สถานะการปฏิบัติการ (Operating Status)' }).click();
	await page.getByRole('option', { name: label }).click();
}

/**
 * Codes of registry masters named {@link SHELTER_NAME}. Covers a run that failed inside
 * `createShelterViaUi` after the save landed but before the edit URL (and so the code) showed.
 */
async function shelterCodesNamed(name: string): Promise<string[]> {
	const res = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (res.status >= 400) return [];
	const rows = (res.data as { rows?: { doc?: { name?: unknown; code?: unknown } }[] }).rows ?? [];
	return rows.flatMap(({ doc }) =>
		doc?.name === name && typeof doc.code === 'string' ? [doc.code] : []
	);
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	const codes = new Set(await shelterCodesNamed(SHELTER_NAME).catch(() => []));
	if (shelterCode) codes.add(shelterCode);
	for (const code of codes) {
		recordCreatedShelter(code, LEDGER_SUITE);
		await teardownShelter(code).catch((err) => console.warn(`teardown ${code} failed:`, err));
	}
	shelterCode = undefined;
	for (const user of users.values()) await deleteCouchUser(user.name).catch(() => undefined);
});

test.describe('Shelter close checks everyone out (CR-219)', { tag: ['@shelter-close'] }, () => {
	test.beforeEach(() => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
	});

	test('provision E2E shelter, staff, and seeded people', async ({ page }) => {
		test.setTimeout(180_000);
		liveWritesStarted = true;
		const admin = await bootstrapAdminSession();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);
		shelterCode = await createShelterViaUi(page, {
			name: SHELTER_NAME,
			siteKind: 'evacuation_center',
			lat: 7.006,
			lng: 100.501,
			subdistrict: 'คอหงส์',
			capacity: 40
		});
		recordCreatedShelter(shelterCode, LEDGER_SUITE);
		await ensureUsers(shelterCode);
		await seedPeople();
	});

	test('FR-7 preview counts affected people by status', async () => {
		const res = await api('manager', 'GET', `/api/back-office/shelter/${shelterCode}/close`);
		expect(res.status).toBe(200);
		expect(res.data).toEqual({
			by_status: { active: 1, temporary_leave: 1, pre_registered: 3, arriving: 1 },
			total: 6
		});
	});

	test('FR-22 guards: other roles 403, direct PATCH 400, wrong confirm 400 — nothing written', async () => {
		const close = `/api/back-office/shelter/${shelterCode}/close`;
		expect((await api('staff', 'GET', close)).status).toBe(403);
		expect((await api('otherManager', 'GET', close)).status).toBe(403);
		expect(
			(await api('otherManager', 'POST', close, { confirm_text: confirmPhrase() })).status
		).toBe(403);

		const patch = await api('manager', 'PATCH', `/api/back-office/shelter/${shelterCode}`, {
			operation_status: 'closed'
		});
		expect(patch.status).toBe(400);

		const wrong = await api('manager', 'POST', close, { confirm_text: `${shelterCode} ผิด` });
		expect(wrong.status).toBe(400);
		const lower = await api('manager', 'POST', close, {
			confirm_text: confirmPhrase().toLowerCase()
		});
		expect(lower.status).toBe(400);

		expect((await registryStatus()).operation_status).toBe('active');
		expect(await docsOfType('movement')).toEqual([]);
		expect((await stays())['evacuee:E2ECLOSE01']).toBe('active');
	});

	test('FR-18 cancelling the modal writes nothing and reverts the status', async ({ browser }) => {
		const page = await openEditAsManager(browser);
		await pickStatus(page, 'ปิดศูนย์ (Closed)');
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText(`ยืนยันปิดศูนย์ ${SHELTER_NAME}`)).toBeVisible();
		await expect(dialog.getByText('ผู้พักพิงที่จะได้รับผลกระทบ 6 คน')).toBeVisible();
		await dialog.getByRole('button', { name: 'ยกเลิก' }).click();
		await expect(dialog).toBeHidden();

		await expect(
			page.getByRole('button', { name: 'สถานะการปฏิบัติการ (Operating Status)' })
		).toContainText('เปิดรับผู้อพยพ (Active)');
		expect((await registryStatus()).operation_status).toBe('active');
		expect(await docsOfType('movement')).toEqual([]);
		await page.context().close();
	});

	test('SM closes via the modal: everyone checked out / cancelled, then the shelter closes', async ({
		browser
	}) => {
		test.setTimeout(120_000);
		const page = await openEditAsManager(browser);
		await pickStatus(page, 'ปิดศูนย์ (Closed)');
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('ผู้พักพิงที่จะได้รับผลกระทบ 6 คน')).toBeVisible();
		await expect(dialog.getByText('ลงทะเบียนล่วงหน้า', { exact: true })).toBeVisible();
		await expect(dialog.getByText('ออกชั่วคราว', { exact: true })).toBeVisible();

		const confirm = dialog.getByRole('button', { name: 'เช็คเอาต์ทั้งหมดและปิดศูนย์' });
		const input = dialog.locator('#shelter-close-confirm');
		await input.fill(`${shelterCode} ชื่อผิด`);
		await expect(confirm).toBeDisabled();
		await input.fill(`  ${confirmPhrase()}  `);
		await expect(confirm).toBeEnabled();
		await confirm.click();

		await expect(page.getByText('ปิดศูนย์แล้ว · เช็คเอาต์ 3 คน · ยกเลิก 3 คน')).toBeVisible({
			timeout: 60_000
		});
		await expect(dialog).toBeHidden();

		// FR-13: registry closed with a retention clock.
		await expect.poll(async () => (await registryStatus()).operation_status).toBe('closed');
		expect((await registryStatus()).closed_at).toBeTruthy();

		// FR-2 / FR-6: statuses.
		expect(await stays()).toEqual({
			'evacuee:E2ECLOSE01': 'checked_out',
			'evacuee:E2ECLOSE02': 'checked_out',
			'evacuee:E2ECLOSE03': 'cancelled',
			'evacuee:E2ECLOSE04': 'cancelled',
			'evacuee:E2ECLOSE05': 'cancelled',
			'evacuee:E2ECLOSE06': 'checked_out',
			'evacuee:E2ECLOSE07': 'checked_out'
		});

		// FR-4: one check_out movement per checked-out person, by the manager.
		const movements = await docsOfType('movement');
		expect(movements.map((m) => m.evacuee_id).sort()).toEqual([
			'evacuee:E2ECLOSE01',
			'evacuee:E2ECLOSE02',
			'evacuee:E2ECLOSE06'
		]);
		for (const m of movements) {
			expect(m).toMatchObject({
				action: 'check_out',
				reason: 'shelter_closed',
				zone: null,
				created_by: users.get('manager')!.name
			});
		}

		// FR-5 / FR-6b: households.
		const households = Object.fromEntries((await docsOfType('household')).map((h) => [h._id, h]));
		expect(households['household:E2ECLOSEH1']).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});
		expect(households['household:E2ECLOSEH2']).toMatchObject({
			status: 'cancelled',
			checkout_destination: null
		});
		expect(households['household:E2ECLOSEH3']).toMatchObject({
			status: 'checked_out',
			checkout_destination: { type: 'shelter_closed' }
		});

		// FR-6a: one audit per household with cancelled members.
		const audits = (await docsOfType('audit')).filter((a) => a.reason === 'shelter_closed');
		expect(audits.map((a) => a.target_id).sort()).toEqual([
			'household:E2ECLOSEH2',
			'household:E2ECLOSEH3'
		]);
		await page.context().close();
	});

	test('FR-12 a second close is a no-op: no duplicate movements', async () => {
		const res = await api('manager', 'POST', `/api/back-office/shelter/${shelterCode}/close`, {
			confirm_text: confirmPhrase()
		});
		expect(res.status).toBe(200);
		expect(res.data).toEqual({ closed: true, checked_out: 0, cancelled: 0, failed: [] });
		expect(await docsOfType('movement')).toHaveLength(3);
	});

	test('FR-25 the manager reopens the shelter; nobody gets a stay back', async ({ browser }) => {
		const before = await stays();
		const page = await openEditAsManager(browser);
		await pickStatus(page, 'เปิดรับผู้อพยพ (Active)');
		await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect.poll(async () => (await registryStatus()).operation_status).toBe('active');
		expect(await stays()).toEqual(before);
		expect(await docsOfType('movement')).toHaveLength(3);
		await page.context().close();
	});

	test('Z teardown', async () => {
		test.setTimeout(180_000);
		await teardownShelter(shelterCode!);
		shelterCode = undefined;
		for (const user of users.values()) await deleteCouchUser(user.name);
	});
});
