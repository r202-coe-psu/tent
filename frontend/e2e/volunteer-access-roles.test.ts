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
		// The dialog opens on registration_staff; its trigger is a button named after that role.
		await dialog.getByRole('button', { name: 'เจ้าหน้าที่ลงทะเบียน' }).click();
		await page.getByRole('option', { name: 'เจ้าหน้าที่แจกจ่าย', exact: true }).click();
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

	test.fixme('volunteer_coordinator issues limited system access to volunteers (#879 item 2, built in #955)', async ({
		browser
	}) => {
		const page = await openAs(browser, roleUser('volunteer_coordinator'));
		await page.goto('/back-office/volunteers?tab=people');
		await expect(page.getByRole('button', { name: 'ออกสิทธิ์ใช้งานระบบ' }).first()).toBeVisible();
		await page.context().close();
	});
});
