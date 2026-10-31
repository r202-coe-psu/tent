/**
 * Volunteer system access (#841) — the role a volunteer is granted really opens the pages the
 * users-page role picker (`ROLE_OPTIONS` in `user-form.svelte`) promises, and nothing else.
 *
 * Two groups, both on SH001 with per-run accounts and a per-run volunteer doc (nothing seeded is
 * touched; no shelter policy is changed):
 *  1. One grant through the real "ออกสิทธิ์ใช้งานระบบ" dialog (`distribution_staff`): `_users`
 *     roles are compound, a retry relinks without touching the password, and the new account
 *     signs in and reaches `/onsite/distribution`.
 *  2. A table for every `STAFF_CAPABILITIES` role. Accounts are created directly with
 *     `rolesFromAssignments` (the roles the dialog writes). Per role: `/portal` shows only its
 *     department, allowed URLs load, forbidden URLs bounce back to `/portal`.
 *
 * A third group (#955, #879 item 2) pins the limits of a `volunteer_coordinator` granting access:
 * own shelter, the coordinator roles (all staff roles but volunteer_coordinator / kiosk_staff), verified identity, a required expiry within 7 days, and the account
 * shape (`role_grants`). Expiry revocation by the worker is covered by worker unit tests.
 *
 * The table records the REAL guard behaviour. Permissions are not changed here (a change needs
 * a CR).
 *
 * Tags: `@volunteers` + `@critical` + `@release`. Local: `docker compose up -d`, then
 *   pnpm exec playwright test e2e/volunteer-access-roles.test.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
	STAFF_CAPABILITIES,
	rolesFromAssignments,
	type StaffCapability
} from '../src/lib/auth/roles';
import {
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	deleteDocument,
	getDocument,
	putDocument,
	seedSecurityQuestion,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, READ_ONLY_REASON, appBaseUrl } from './helpers/e2e-env';
import { SHELTER_DB } from './helpers/households';
import { openAsShelterStaff } from './helpers/onsite';

const TAGS = ['@volunteers', '@critical', '@release'];
const SHELTER = 'SH001';
const PASSWORD = 'E2e-Volunteer-Pass1!';
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

test.skip(!CAN_WRITE, READ_ONLY_REASON);
test.use({ actionTimeout: 15_000 });

interface RoleAccess {
	role: StaffCapability;
	/** `portal-dept-<id>` sections `/portal` must show for this role, and no others. */
	portalDepartments: string[];
	/** `/portal` shows the registration tile only while the shelter has Station 2 switched on. */
	needsMedicalScreening?: true;
	/** URLs the role description promises and the guard allows. */
	allowed: string[];
	/** URLs of other departments (real guard behaviour). */
	forbidden: string[];
}

/** Role to pages, one row per `STAFF_CAPABILITIES` entry. */
const ROLE_ACCESS: RoleAccess[] = [
	{
		role: 'registration_staff',
		portalDepartments: ['registration'],
		allowed: ['/onsite/people', '/onsite/scan-check-in-out', '/back-office/evacuee-management'],
		forbidden: ['/back-office/supply', '/back-office/kitchen']
	},
	{
		role: 'triage_staff',
		portalDepartments: ['registration'],
		needsMedicalScreening: true,
		allowed: ['/onsite/medical-screening'],
		forbidden: ['/onsite/people', '/back-office/supply']
	},
	{
		role: 'medical_staff',
		portalDepartments: ['registration'],
		needsMedicalScreening: true,
		allowed: ['/onsite/medical-screening'],
		// #879 item 1: referrals stay manager-only; the description was fixed instead (#954).
		forbidden: ['/back-office/kitchen', '/back-office/referrals']
	},
	{
		role: 'kitchen_staff',
		portalDepartments: ['kitchen'],
		allowed: ['/back-office/kitchen', '/back-office/tickets/kitchen'],
		forbidden: ['/back-office/supply']
	},
	{
		role: 'supply_coordinator',
		portalDepartments: ['supply'],
		allowed: ['/back-office/supply', '/back-office/stock-donations', '/back-office/distribution'],
		forbidden: ['/back-office/kitchen']
	},
	{
		role: 'warehouse_staff',
		portalDepartments: ['supply'],
		allowed: ['/back-office/supply'],
		forbidden: ['/back-office/kitchen']
	},
	{
		role: 'distribution_staff',
		portalDepartments: ['supply'],
		allowed: ['/onsite/distribution'],
		forbidden: ['/back-office/supply', '/back-office/distribution']
	},
	{
		role: 'kiosk_staff',
		portalDepartments: ['management'],
		allowed: ['/back-office/kiosks', '/back-office/kiosks/banners'],
		forbidden: ['/back-office/volunteers', '/back-office/supply']
	},
	{
		// CR-203 (#930): confined to the banner pages.
		role: 'pr_staff',
		portalDepartments: ['pr'],
		allowed: ['/back-office/kiosks/banners'],
		forbidden: ['/back-office/kiosks', '/back-office/supply']
	},
	{
		role: 'facility_staff',
		portalDepartments: ['facility'],
		allowed: ['/onsite/zoning'],
		forbidden: ['/back-office/supply']
	},
	{
		role: 'volunteer_coordinator',
		portalDepartments: ['volunteer'],
		allowed: ['/back-office/volunteers', '/onsite/volunteer-check-in'],
		forbidden: ['/back-office/supply']
	},
	{
		role: 'security_officer',
		portalDepartments: ['security'],
		// `requireIncidents` admits any staff of the shelter, so this URL does not single the role
		// out; the portal department and the bounce from supply do.
		allowed: ['/back-office/incidents'],
		forbidden: ['/back-office/supply']
	}
];

const roleUser = (role: StaffCapability): TestUser => ({
	name: `e2e_vaccess_${RUN_ID}_${role}`,
	password: PASSWORD,
	roles: rolesFromAssignments([{ shelter_code: SHELTER, capabilities: [role] }]),
	display_name: `E2E Access ${role}`
});

const sessions = new Map<string, string>();

async function openAs(browser: Browser, user: TestUser): Promise<Page> {
	return openAsShelterStaff(browser, user, sessions.get(user.name)!, SHELTER);
}

async function createStaffAccount(user: TestUser): Promise<void> {
	await createCouchUser(user);
	// Without a security question the first login is sent to /force-setup instead of the page.
	await seedSecurityQuestion(user.name);
	sessions.set(user.name, await couchLogin(user.name, user.password));
}

async function medicalScreeningEnabled(): Promise<boolean> {
	const res = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(SHELTER))}&include_docs=true`
	);
	const row = (
		res.data as { rows?: { doc?: { feature_flags?: { enable_medical_screening?: boolean } } }[] }
	).rows?.[0];
	return row?.doc?.feature_flags?.enable_medical_screening === true;
}

async function portalDepartments(page: Page): Promise<string[]> {
	return page
		.locator('h2[id^="portal-dept-"]')
		.evaluateAll((els) => els.map((el) => el.id.replace('portal-dept-', '')));
}

const pathOf = (page: Page) => new URL(page.url()).pathname;

async function expectLoads(page: Page, url: string): Promise<void> {
	await page.goto(url);
	// Guards run in the route `load` and SvelteKit renders only after every load resolves, so the
	// protected shell's <main> means the guard has passed or redirected. Not `networkidle`: the
	// `_changes` longpoll feeds keep the network busy for good.
	await expect(page.locator('main').first()).toBeVisible();
	expect.soft(pathOf(page), `${url} should load`).toBe(url);
}

async function expectBouncedToPortal(page: Page, url: string): Promise<void> {
	await page.goto(url);
	await expect.poll(() => pathOf(page), { message: `${url} should redirect` }).toBe('/portal');
}

test.describe('Volunteer access: grant dialog', { tag: TAGS }, () => {
	test.describe.configure({ mode: 'serial' });

	const manager: TestUser = {
		name: `e2e_vaccess_${RUN_ID}_manager`,
		password: PASSWORD,
		roles: rolesFromAssignments([{ shelter_code: SHELTER, capabilities: ['shelter_manager'] }]),
		display_name: 'E2E Access Manager'
	};
	const volunteerId = `volunteer:E2E${RUN_ID.toUpperCase()}`;
	const email = `e2e-vaccess-${RUN_ID}@example.com`;
	const firstName = `E2E${RUN_ID}`;
	const now = new Date().toISOString();

	test.beforeAll(async () => {
		await createStaffAccount(manager);
		await putDocument(SHELTER_DB, {
			_id: volunteerId,
			type: 'volunteer',
			schema_v: 4,
			shelter_code: SHELTER,
			created_at: now,
			updated_at: now,
			created_by: manager.name,
			first_name: firstName,
			last_name: 'ทดสอบสิทธิ์',
			phone: null,
			email: null,
			skills: [],
			status: 'active',
			user_name: null,
			checked_in: false,
			volunteer_code: `E2E-${RUN_ID}`,
			identity_verified: false,
			source: 'staff_entry',
			personnel_type: 'volunteer'
		});
	});

	test.afterAll(async () => {
		await deleteCouchUser(email);
		await deleteCouchUser(manager.name);
		const doc = await getDocument(SHELTER_DB, volunteerId);
		if (doc) await deleteDocument(SHELTER_DB, doc);
		expect(await getDocument(SHELTER_DB, volunteerId), 'volunteer doc removed').toBeNull();
		const user = await couchReq('GET', `/_users/org.couchdb.user:${encodeURIComponent(email)}`);
		expect(user.status, 'granted account removed').toBe(404);
	});

	async function grantDistributionStaff(page: Page): Promise<void> {
		await page.getByRole('button', { name: 'ออกสิทธิ์ใช้งานระบบ' }).click();
		const dialog = page.getByRole('dialog');
		// No role is preselected (#1072): the grantor picks one of the radios.
		await dialog.getByRole('radio', { name: 'เจ้าหน้าที่แจกจ่าย', exact: true }).check();
		await dialog.getByLabel('อีเมลสำหรับเข้าสู่ระบบ').fill(email);
		await dialog.getByLabel(/รหัสผ่านสำหรับบัญชีใหม่/).fill(PASSWORD);
		await dialog.getByRole('button', { name: 'บันทึกและออกสิทธิ์ใหม่' }).click();
	}

	test('manager grants distribution_staff, then manages it as an account, and it reaches its desk', async ({
		browser
	}) => {
		const page = await openAs(browser, manager);
		await page.goto('/back-office/volunteers?tab=people');
		await page.getByPlaceholder('ค้นหาชื่อ นามสกุล เบอร์โทร, รหัส...').fill(firstName);

		await grantDistributionStaff(page);
		await expect(page.getByText(`สร้างบัญชี (${email}) และออกสิทธิ์แล้ว`)).toBeVisible();

		const created = await getDocument('_users', `org.couchdb.user:${email}`);
		expect(created?.roles).toEqual([`shelter:${SHELTER}`, `${SHELTER}:distribution_staff`]);
		expect(created?.personnel_type).toBe('volunteer');
		expect(created?.volunteer_id).toBe(volunteerId);
		expect((await getDocument(SHELTER_DB, volunteerId))?.user_name).toBe(email);

		// Once linked, the card sends a manager to the user page instead of re-granting (#953);
		// relinking an existing account without touching its password is unit-tested.
		await expect(page.getByRole('link', { name: 'จัดการบัญชีผู้ใช้' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'ออกสิทธิ์ใช้งานระบบ' })).toHaveCount(0);
		await page.context().close();

		await seedSecurityQuestion(email);
		const account: TestUser = {
			name: email,
			password: PASSWORD,
			roles: created!.roles as string[]
		};
		sessions.set(email, await couchLogin(email, PASSWORD));
		const desk = await openAs(browser, account);
		await desk.goto('/portal');
		await expect.poll(() => portalDepartments(desk)).toEqual(['supply']);
		await expectLoads(desk, '/onsite/distribution');
		await expectBouncedToPortal(desk, '/back-office/supply');
		await desk.context().close();
	});
});

test.describe('Volunteer access: every staff role', { tag: TAGS }, () => {
	test.beforeAll(async () => {
		for (const { role } of ROLE_ACCESS) await createStaffAccount(roleUser(role));
	});

	test.afterAll(async () => {
		for (const { role } of ROLE_ACCESS) await deleteCouchUser(roleUser(role).name);
	});

	test('the table covers every STAFF_CAPABILITIES role', () => {
		expect(ROLE_ACCESS.map((row) => row.role).sort()).toEqual([...STAFF_CAPABILITIES].sort());
	});

	for (const row of ROLE_ACCESS) {
		test(`${row.role} reaches only its own pages`, async ({ browser }) => {
			const page = await openAs(browser, roleUser(row.role));
			await page.goto('/portal');
			const expected = row.needsMedicalScreening && !(await medicalScreeningEnabled());
			await expect
				.poll(() => portalDepartments(page), { message: 'portal departments' })
				.toEqual(expected ? [] : row.portalDepartments);
			for (const url of row.allowed) await expectLoads(page, url);
			for (const url of row.forbidden) await expectBouncedToPortal(page, url);
			await page.context().close();
		});
	}

	test('volunteer_coordinator cannot create accounts (real behaviour)', async () => {
		const session = sessions.get(roleUser('volunteer_coordinator').name)!;
		const res = await fetch(`${appBaseUrl()}/api/v1/users`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Cookie: `AuthSession=${session}` },
			body: JSON.stringify({
				name: `e2e_vaccess_${RUN_ID}_nobody`,
				password: PASSWORD,
				display_name: 'E2E Nobody',
				roles: rolesFromAssignments([
					{ shelter_code: SHELTER, capabilities: ['registration_staff'] }
				])
			})
		});
		expect(res.status).toBe(403);
	});
});

/** Asia/Bangkok calendar date `daysAhead` days from now, as `YYYY-MM-DD`. */
function bangkokDate(daysAhead: number): string {
	const today = new Intl.DateTimeFormat('en-CA', {
		timeZone: 'Asia/Bangkok',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit'
	}).format(new Date());
	const [y, m, d] = today.split('-').map(Number);
	return new Date(Date.UTC(y, m - 1, d + daysAhead)).toISOString().slice(0, 10);
}

test.describe('Volunteer access: coordinator limits (#955)', { tag: TAGS }, () => {
	test.describe.configure({ mode: 'serial' });

	const coordinator: TestUser = {
		name: `e2e_vaccess_${RUN_ID}_coord`,
		password: PASSWORD,
		roles: rolesFromAssignments([
			{ shelter_code: SHELTER, capabilities: ['volunteer_coordinator'] }
		]),
		display_name: 'E2E Access Coordinator'
	};
	const verifiedId = `volunteer:E2EV${RUN_ID.toUpperCase()}`;
	const unverifiedId = `volunteer:E2EU${RUN_ID.toUpperCase()}`;
	const grantEmail = `e2e-vaccess-${RUN_ID}-grant@example.com`;
	const now = new Date().toISOString();

	const volunteerDoc = (id: string, verified: boolean, name: string) => ({
		_id: id,
		type: 'volunteer',
		schema_v: 4,
		shelter_code: SHELTER,
		created_at: now,
		updated_at: now,
		created_by: coordinator.name,
		first_name: name,
		last_name: 'ทดสอบสิทธิ์',
		phone: null,
		email: null,
		skills: [],
		status: 'active',
		user_name: null,
		checked_in: false,
		volunteer_code: `E2E-${name}`,
		identity_verified: verified,
		identity_verification: { status: verified ? 'verified' : 'pending' },
		source: 'staff_entry',
		personnel_type: 'volunteer'
	});

	function grantRequest(over: Record<string, unknown> = {}) {
		return fetch(`${appBaseUrl()}/api/v1/volunteer-access`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Cookie: `AuthSession=${sessions.get(coordinator.name)}`
			},
			body: JSON.stringify({
				shelter_code: SHELTER,
				volunteer_id: verifiedId,
				email: grantEmail,
				password: PASSWORD,
				role: 'distribution_staff',
				expires_on: bangkokDate(3),
				...over
			})
		});
	}

	test.beforeAll(async () => {
		await createStaffAccount(coordinator);
		await putDocument(SHELTER_DB, volunteerDoc(verifiedId, true, `E2EV${RUN_ID}`));
		await putDocument(SHELTER_DB, volunteerDoc(unverifiedId, false, `E2EU${RUN_ID}`));
	});

	test.afterAll(async () => {
		await deleteCouchUser(grantEmail);
		await deleteCouchUser(coordinator.name);
		for (const id of [verifiedId, unverifiedId]) {
			const doc = await getDocument(SHELTER_DB, id);
			if (doc) await deleteDocument(SHELTER_DB, doc);
		}
	});

	test('the people tab offers a grant dialog with a required, empty expiry field', async ({
		browser
	}) => {
		const page = await openAs(browser, coordinator);
		await page.goto('/back-office/volunteers?tab=people');
		await page.getByPlaceholder('ค้นหาชื่อ นามสกุล เบอร์โทร, รหัส...').fill(`E2EV${RUN_ID}`);
		await page.getByRole('button', { name: 'ออกสิทธิ์ใช้งานระบบ' }).click();

		// A date picker (#1044): empty until chosen, and only today through today + 7 can be picked.
		const expiry = page.getByRole('dialog').getByLabel(/วันหมดอายุของสิทธิ์/);
		await expect(expiry).toBeVisible();
		await expect(expiry).toContainText('เลือกวันหมดอายุ');
		await expiry.click();
		// Days of the shown month only; the window's last day may sit in the next month.
		const day = (iso: string) =>
			page.locator(`[data-calendar-cell][data-value="${iso}"]:not([data-outside-month])`);
		await expect(day(bangkokDate(0))).not.toHaveAttribute('data-disabled');
		if (bangkokDate(8).slice(0, 7) === bangkokDate(0).slice(0, 7)) {
			await expect(day(bangkokDate(8))).toHaveAttribute('data-disabled');
		}
		await page.keyboard.press('Escape');

		await page.getByRole('dialog').getByLabel('อีเมลสำหรับเข้าสู่ระบบ').fill(grantEmail);
		await page
			.getByRole('dialog')
			.getByLabel(/รหัสผ่านสำหรับบัญชีใหม่/)
			.fill(PASSWORD);
		await page.getByRole('dialog').getByRole('button', { name: 'บันทึกและออกสิทธิ์ใหม่' }).click();
		// No role is preselected (#1072), so the role is asked for first.
		await expect(page.getByText('กรุณาเลือกตำแหน่งหน้าที่')).toBeVisible();
		await page
			.getByRole('dialog')
			.getByRole('radio', { name: 'เจ้าหน้าที่ลงทะเบียน', exact: true })
			.check();
		await page.getByRole('dialog').getByRole('button', { name: 'บันทึกและออกสิทธิ์ใหม่' }).click();
		await expect(page.getByText('กรุณาเลือกวันหมดอายุ')).toBeVisible();
		expect(
			await getDocument('_users', `org.couchdb.user:${grantEmail}`),
			'nothing created'
		).toBeNull();
		await page.context().close();
	});

	test('grants distribution_staff for 3 days: scoped roles plus one role_grants entry', async () => {
		const res = await grantRequest();
		expect(res.status).toBe(200);

		const doc = await getDocument('_users', `org.couchdb.user:${grantEmail}`);
		expect(doc?.roles).toEqual([`shelter:${SHELTER}`, `${SHELTER}:distribution_staff`]);
		expect(doc?.personnel_type).toBe('volunteer');
		expect(doc?.volunteer_id).toBe(verifiedId);
		const grants = doc?.role_grants as Record<string, string>[];
		expect(grants).toHaveLength(1);
		expect(grants[0]).toMatchObject({
			shelter_code: SHELTER,
			role: 'distribution_staff',
			granted_by: coordinator.name
		});
		// End of the chosen Bangkok day, 23:59:59.999 +07:00.
		expect(grants[0].expires_at).toBe(
			new Date(`${bangkokDate(3)}T23:59:59.999+07:00`).toISOString()
		);
		expect(grants[0].granted_at).toBeTruthy();
	});

	test('a re-grant with another role replaces it and renews without touching the password', async () => {
		// One coordinator role per shelter (#1044): kitchen_staff replaces distribution_staff.
		const res = await grantRequest({ role: 'kitchen_staff', password: 'Another-Pass9!' });
		expect(res.status).toBe(200);

		const doc = await getDocument('_users', `org.couchdb.user:${grantEmail}`);
		expect(doc?.roles).toEqual([`shelter:${SHELTER}`, `${SHELTER}:kitchen_staff`]);
		expect(doc?.role_grants as unknown[]).toHaveLength(1);
		await expect(couchLogin(grantEmail, PASSWORD), 'password unchanged').resolves.toBeTruthy();

		await expect(
			grantRequest({ role: 'kitchen_staff', expires_on: bangkokDate(7) })
		).resolves.toMatchObject({ status: 200 });
		const renewed = await getDocument('_users', `org.couchdb.user:${grantEmail}`);
		expect(renewed?.role_grants as unknown[], 'renewed, not duplicated').toHaveLength(1);
	});

	for (const [label, over, status] of [
		['a role the coordinator may not grant (kiosk_staff)', { role: 'kiosk_staff' }, 403],
		['a role above the coordinator (shelter_manager)', { role: 'shelter_manager' }, 403],
		['another shelter', { shelter_code: 'SH002' }, 403],
		['an expiry more than 7 days away', { expires_on: bangkokDate(8) }, 422],
		['an expiry in the past', { expires_on: bangkokDate(-1) }, 422],
		['no expiry', { expires_on: undefined }, 422],
		['a volunteer who is not verified', { volunteer_id: unverifiedId }, 422]
	] as const) {
		test(`refuses ${label}`, async () => {
			const email = `e2e-vaccess-${RUN_ID}-refused@example.com`;
			const res = await grantRequest({ ...over, email });
			expect(res.status).toBe(status);
			expect(
				await getDocument('_users', `org.couchdb.user:${email}`),
				'no account is created'
			).toBeNull();
		});
	}
});
