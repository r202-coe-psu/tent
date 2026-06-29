/**
 * E2E Tests: User Management — UI Flow & Route Guard
 *
 * Strategy: Real BFF + real CouchDB session cookies (Approach #2).
 * - `injectSession()` sets `AuthSession` cookie + `localStorage['auth:user']`
 *   so the SvelteKit auth guard and authStore both see the correct identity.
 * - GET /api/v1/users is intercepted via `page.route()` to supply deterministic
 *   fixture data; write mutations (DELETE) go through the real BFF.
 *
 * Coverage:
 * [Guard]  Unauthenticated visit → redirect to /login
 * [Guard]  registration_staff visit → redirect to /
 * [Guard]  shelter_manager visit → page renders
 * [Guard]  system_admin visit → page renders
 * [UI-SA]  SA sees shelter dropdown in Create User form
 * [UI-SA]  SA sees shelter_manager in capability options
 * [UI-SM]  SM sees locked shelter (no dropdown) in Create User form
 * [UI-SM]  SM cannot see shelter_manager in capability list
 * [UI-SM]  Edit/Delete disabled for manager-level rows
 * [UI-SM]  Edit/Delete enabled for staff rows
 * [UI-SA]  Edit/Delete enabled for all rows
 * [UI]     Search filters user list by username
 * [UI]     Search filters by role name
 * [UI]     Clearing search shows all users
 * [UI]     Delete confirm dialog + real BFF cleanup
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES
} from '../helpers/couch';
import { injectSession, clearSession } from '../helpers/login';

const USERS_URL_PATTERN = '**/api/v1/users';
const SHELTERS_URL_PATTERN = '**/api/back-office/shelter';

/** Mock GET /api/v1/users; write mutations pass through to real BFF. */
async function mockUserList(page: Page, users: Record<string, unknown>[]): Promise<void> {
	await page.route(USERS_URL_PATTERN, async (route) => {
		if (route.request().method() === 'GET') {
			await route.fulfill({
				status: 200,
				contentType: 'application/json',
				body: JSON.stringify(users)
			});
		} else {
			await route.continue();
		}
	});
}

/** Mock shelters endpoint with fixed data. */
async function mockShelters(page: Page, shelters: Record<string, unknown>[] = []): Promise<void> {
	await page.route(SHELTERS_URL_PATTERN, (route) =>
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(shelters) })
	);
}

// ─── fixture users ─────────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36);
const ACCOUNTS = [
	{ name: `ui_sa_${RUN_ID}`, password: 'Password1!', roles: SA_ROLES, display_name: 'UI SA' },
	{
		name: `ui_sm1_${RUN_ID}`,
		password: 'Password1!',
		roles: SM_SH001_ROLES,
		display_name: 'UI SM SH001'
	},
	{
		name: `ui_staff1_${RUN_ID}`,
		password: 'Password1!',
		roles: STAFF_SH001_ROLES,
		display_name: 'UI Staff SH001'
	}
];

const sessions: Record<string, string> = {};
const createdDuringTest: string[] = [];

test.beforeAll(async () => {
	for (const acc of ACCOUNTS) await createCouchUser(acc);
	for (const acc of ACCOUNTS) sessions[acc.name] = await couchLogin(acc.name, acc.password);
});

test.afterAll(async () => {
	for (const acc of ACCOUNTS) await deleteCouchUser(acc.name);
});

test.afterEach(async ({ page }) => {
	// Clean up any users created mid-test
	for (const name of createdDuringTest.splice(0)) {
		await deleteCouchUser(name);
	}
	// Reset browser state
	await clearSession(page);
});

const SA = ACCOUNTS[0];
const SM1 = ACCOUNTS[1];
const STAFF1 = ACCOUNTS[2];

// ─── Fixture data for UI rendering ────────────────────────────────────────────

const FIXTURE_USERS = [
	{
		name: 'john_staff',
		display_name: 'John Staff',
		roles: ['shelter:SH001', 'registration_staff'],
		shelter_id: 'SH001',
		affiliation_tags: []
	},
	{
		name: 'jane_manager',
		display_name: 'Jane Manager',
		roles: ['shelter:SH001', 'shelter_manager'],
		shelter_id: 'SH001',
		affiliation_tags: []
	},
	{
		name: 'bob_kitchen',
		display_name: 'Bob Kitchen',
		roles: ['shelter:SH001', 'kitchen_staff'],
		shelter_id: 'SH001',
		affiliation_tags: ['volunteer']
	}
];

// ─── Route Guards ──────────────────────────────────────────────────────────────

test.describe('User Management UI — Route Guards', () => {
	test('unauthenticated user is redirected to /login', async ({ page }) => {
		await page.context().clearCookies();
		await page.goto('http://localhost:4173/login', { waitUntil: 'domcontentloaded' });
		await page.evaluate(() => localStorage.removeItem('auth:user'));
		await page.goto('http://localhost:4173/back-office/users');
		await expect(page).toHaveURL(/\/login/);
	});

	test('registration_staff is redirected to / (not a manager)', async ({ page }) => {
		await injectSession(page, STAFF1, sessions[STAFF1.name]);
		await mockUserList(page, []);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');
		// Should be redirected away from users page by requireManager()
		await page.waitForURL((url) => !url.pathname.includes('/back-office/users'), { timeout: 8000 });
		await expect(page).not.toHaveURL(/back-office\/users/);
	});

	test('shelter_manager can access /back-office/users', async ({ page }) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');
		await expect(page.getByRole('heading', { level: 1, name: /User Management/i })).toBeVisible({
			timeout: 8000
		});
	});

	test('system_admin can access /back-office/users', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page, [{ code: 'SH001', name: 'Test Shelter' }]);
		await page.goto('http://localhost:4173/back-office/users');
		await expect(page.getByRole('heading', { level: 1, name: /User Management/i })).toBeVisible({
			timeout: 8000
		});
	});
});

// ─── Role-Aware Form Rendering ─────────────────────────────────────────────────

test.describe('User Management UI — Role-Aware Form Rendering', () => {
	test.beforeEach(async ({ page }) => {
		await mockShelters(page, [
			{ code: 'SH001', name: 'Shelter Songkhla' },
			{ code: 'SH002', name: 'Shelter Pattani' }
		]);
	});

	test('SA: Create User form shows shelter dropdown', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, []);
		await page.goto('http://localhost:4173/back-office/users');
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();
		await expect(page.locator('select[name="shelter_id"]')).toBeVisible();
	});

	test('SA: Create User form shows shelter_manager in capability options', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, []);
		await page.goto('http://localhost:4173/back-office/users');
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();
		const capSelect = page.locator('select[name="capability"]');
		await expect(capSelect).toBeVisible();
		const options = await capSelect.locator('option').allTextContents();
		expect(options).toContain('shelter_manager');
	});

	test('SM: Create User form shows fixed shelter code (no dropdown)', async ({ page }) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, []);
		await page.goto('http://localhost:4173/back-office/users');
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();
		// SM should NOT see a shelter select
		await expect(page.locator('select[name="shelter_id"]')).not.toBeVisible();
		// Should show their shelter code as static text
		await expect(page.getByText(/SH001.*your shelter/i)).toBeVisible();
	});

	test('SM: Create User form does NOT include shelter_manager in capabilities', async ({
		page
	}) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, []);
		await page.goto('http://localhost:4173/back-office/users');
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();
		const capSelect = page.locator('select[name="capability"]');
		await expect(capSelect).toBeVisible();
		const options = await capSelect.locator('option').allTextContents();
		expect(options).not.toContain('shelter_manager');
		expect(options).toContain('registration_staff');
		expect(options).toContain('kitchen_staff');
		expect(options).toContain('warehouse_staff');
	});
});

// ─── Action Buttons (RBAC) ─────────────────────────────────────────────────────

test.describe('User Management UI — Action Buttons (RBAC)', () => {
	test('SM: Edit and Delete buttons are disabled for shelter_manager rows', async ({ page }) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		const managerRow = page.locator('tr').filter({ hasText: 'jane_manager' });
		await expect(managerRow).toBeVisible();
		await expect(managerRow.getByRole('button', { name: /จัดการ/ })).toBeDisabled();
	});

	test('SM: Edit button is enabled for staff rows', async ({ page }) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		const staffRow = page.locator('tr').filter({ hasText: 'john_staff' });
		await expect(staffRow).toBeVisible();
		await expect(staffRow.getByRole('button', { name: /จัดการ/ })).toBeEnabled();
	});

	test('SA: Edit button is enabled for all rows including manager', async ({ page }) => {
		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		const managerRow = page.locator('tr').filter({ hasText: 'jane_manager' });
		await expect(managerRow).toBeVisible();
		await expect(managerRow.getByRole('button', { name: /จัดการ/ })).toBeEnabled();
	});
});

// ─── Search ────────────────────────────────────────────────────────────────────

test.describe('User Management UI — Search', () => {
	async function setupPage(page: Page): Promise<void> {
		await injectSession(page, SM1, sessions[SM1.name]);
		await mockUserList(page, FIXTURE_USERS);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');
		await expect(page.getByPlaceholder(/ค้นหา/i)).toBeVisible();
	}

	test('search input filters the user list by username', async ({ page }) => {
		await setupPage(page);
		await page.getByPlaceholder(/ค้นหา/i).fill('john');
		await expect(page.getByText('john_staff')).toBeVisible();
		await expect(page.getByText('jane_manager')).not.toBeVisible();
		await expect(page.getByText('bob_kitchen')).not.toBeVisible();
	});

	test('search input filters by role name', async ({ page }) => {
		await setupPage(page);
		await page.getByPlaceholder(/ค้นหา/i).fill('kitchen');
		await expect(page.getByText('bob_kitchen')).toBeVisible();
		await expect(page.getByText('john_staff')).not.toBeVisible();
	});

	test('clearing search shows all users again', async ({ page }) => {
		await setupPage(page);
		const searchInput = page.getByPlaceholder(/ค้นหา/i);
		await searchInput.fill('john');
		await searchInput.fill('');
		await expect(page.getByText('john_staff')).toBeVisible();
		await expect(page.getByText('jane_manager')).toBeVisible();
		await expect(page.getByText('bob_kitchen')).toBeVisible();
	});
});

// ─── Delete Flow (real BFF) ────────────────────────────────────────────────────

test.describe('User Management UI — Delete Flow (real BFF)', () => {
	test('SA can delete a staff user via confirm dialog', async ({ page }) => {
		const victim = `ui_del_victim_${RUN_ID}`;
		await createCouchUser({
			name: victim,
			password: 'Pass1234!',
			roles: STAFF_SH001_ROLES,
			display_name: 'Victim'
		});
		// Cleanup in case test fails before delete
		createdDuringTest.push(victim);

		await injectSession(page, SA, sessions[SA.name]);

		// Show only the victim in the mocked list (GET is mocked; DELETE is real BFF)
		await mockUserList(page, [
			{
				name: victim,
				display_name: 'Victim',
				roles: STAFF_SH001_ROLES,
				shelter_id: 'SH001',
				affiliation_tags: []
			}
		]);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		// Click delete button (last button in the victim row)
		const victimRow = page.locator('tr').filter({ hasText: victim });
		await expect(victimRow).toBeVisible();
		await victimRow.locator('button').last().click();

		// Confirm dialog appears
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('dialog').getByText(victim)).toBeVisible();

		// Confirm deletion — this hits the real BFF → CouchDB
		await page.getByRole('button', { name: /ยืนยันการลบ/ }).click();

		// Dialog should close
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		// Verify user is actually gone from CouchDB
		const auth = 'Basic ' + btoa('admin:password');
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(victim)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(404);

		// Remove from cleanup list since it's already deleted
		const idx = createdDuringTest.indexOf(victim);
		if (idx !== -1) createdDuringTest.splice(idx, 1);
	});
});
