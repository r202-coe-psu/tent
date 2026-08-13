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
 * [Search] filters user list by username or role
 * [Delete] SA can delete a user
 * [Edit]   SA can edit a user
 * [Create] SA can create a user
 */

import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	COUCH_AUTH,
	SA_ROLES,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES
} from '../helpers/couch';
import { injectSession, clearSession } from '../helpers/login';

const USERS_URL_PATTERN = '**/api/v1/users';
const SHELTERS_URL_PATTERN = '**/registry/_all_docs*';

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
	await page.route(SHELTERS_URL_PATTERN, (route) => {
		const rows = shelters.map((s) => ({
			id: `shelter:${s.code}`,
			doc: {
				_id: `shelter:${s.code}`,
				type: 'shelter',
				...s
			}
		}));
		route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows }) });
	});
}

// ─── fixture users ─────────────────────────────────────────────────────────────

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
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

const CAPABILITY_FIELD = 'บทบาท (Role)';
const SHELTER_FIELD = 'Shelter ID (Code)';

async function pickSelectOption(page: Page, fieldLabel: string, option: string | RegExp) {
	await page.getByRole('combobox', { name: fieldLabel }).click();
	await page.getByRole('option', { name: option }).click();
}

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
		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(victim)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(404);

		// Remove from cleanup list since it's already deleted
		const idx = createdDuringTest.indexOf(victim);
		if (idx !== -1) createdDuringTest.splice(idx, 1);
	});

	test('SM can delete a staff user in their shelter', async ({ page }) => {
		const victim = `ui_sm_del_victim_${RUN_ID}`;
		await createCouchUser({
			name: victim,
			password: 'Pass1234!',
			roles: STAFF_SH001_ROLES,
			display_name: 'Victim'
		});
		createdDuringTest.push(victim);

		await injectSession(page, SM1, sessions[SM1.name]);

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

		const victimRow = page.locator('tr').filter({ hasText: victim });
		await expect(victimRow).toBeVisible();
		await victimRow.locator('button').last().click();

		await expect(page.getByRole('dialog')).toBeVisible();
		await page.getByRole('button', { name: /ยืนยันการลบ/ }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(victim)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(404);

		const idx = createdDuringTest.indexOf(victim);
		if (idx !== -1) createdDuringTest.splice(idx, 1);
	});
});

// ─── Edit Flow (real BFF) ──────────────────────────────────────────────────────

test.describe('User Management UI — Edit Flow (real BFF)', () => {
	test('SA can edit an existing user', async ({ page }) => {
		const target = `ui_edit_${RUN_ID}`;
		await createCouchUser({
			name: target,
			password: 'Password1!',
			roles: STAFF_SH001_ROLES,
			display_name: 'Old Name'
		});
		createdDuringTest.push(target);

		await injectSession(page, SA, sessions[SA.name]);

		await mockUserList(page, [
			{
				name: target,
				display_name: 'Old Name',
				roles: STAFF_SH001_ROLES,
				shelter_id: 'SH001',
				affiliation_tags: []
			}
		]);
		await mockShelters(page, [{ code: 'SH001', name: 'Test Shelter' }]);
		await page.goto('http://localhost:4173/back-office/users');

		// Click edit button (usually the first button in the row)
		const targetRow = page.locator('tr').filter({ hasText: target });
		await expect(targetRow).toBeVisible();
		await targetRow.locator('button').first().click();

		await expect(page.getByRole('dialog')).toBeVisible();

		// Change display name
		await page.locator('input[name="display_name"]').fill('New Name Edited');

		// Submit
		await page.getByRole('button', { name: /บันทึก/ }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		// Verify change in CouchDB
		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(target)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.display_name).toBe('New Name Edited');
	});

	test('SM can edit a staff user in their shelter', async ({ page }) => {
		const target = `ui_sm_edit_${RUN_ID}`;
		await createCouchUser({
			name: target,
			password: 'Password1!',
			roles: STAFF_SH001_ROLES,
			display_name: 'Old Name'
		});
		createdDuringTest.push(target);

		await injectSession(page, SM1, sessions[SM1.name]);

		await mockUserList(page, [
			{
				name: target,
				display_name: 'Old Name',
				roles: STAFF_SH001_ROLES,
				shelter_id: 'SH001',
				affiliation_tags: []
			}
		]);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		const targetRow = page.locator('tr').filter({ hasText: target });
		await expect(targetRow).toBeVisible();
		await targetRow.locator('button').first().click();

		await expect(page.getByRole('dialog')).toBeVisible();

		await page.locator('input[name="display_name"]').fill('SM Edited Name');

		await page.getByRole('button', { name: /บันทึก/ }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(target)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.display_name).toBe('SM Edited Name');
	});
});

// ─── Create Flow (real BFF) ────────────────────────────────────────────────────

test.describe('User Management UI — Create Flow (real BFF)', () => {
	test('SA can create a new shelter manager', async ({ page }) => {
		const newUsername = `ui_new_sm_${RUN_ID}`;
		// Ensure it gets cleaned up after test
		createdDuringTest.push(newUsername);

		await injectSession(page, SA, sessions[SA.name]);

		await mockUserList(page, []);
		await mockShelters(page, [{ code: 'SH001', name: 'Test Shelter' }]);
		await page.goto('http://localhost:4173/back-office/users');

		// Click create button
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();

		// Fill form
		await expect(page.getByRole('dialog')).toBeVisible();
		await page.locator('input[name="username"]').fill(newUsername);
		await page.locator('input[name="password"]').fill('TestPass1234!');
		await page.locator('input[name="display_name"]').fill('New UI SM');

		// Back-office users is locked to the header shelter — no picker, even for SA.
		await expect(page.getByRole('combobox', { name: SHELTER_FIELD })).toHaveCount(0);
		await expect(page.getByRole('dialog').getByText('SH001')).toBeVisible();
		await pickSelectOption(page, CAPABILITY_FIELD, 'ผู้จัดการศูนย์');

		// Submit form
		await page.getByRole('button', { name: /บันทึก/ }).click();

		// Wait for dialog to close indicating success
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		// Verify user is actually created in CouchDB
		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(newUsername)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.roles).toContain('shelter:SH001');
		expect(doc.roles).toContain('shelter_manager');
		expect(doc.display_name).toBe('New UI SM');
	});

	test('SM can create a new staff user in their shelter', async ({ page }) => {
		const newUsername = `ui_new_staff_${RUN_ID}`;
		createdDuringTest.push(newUsername);

		await injectSession(page, SM1, sessions[SM1.name]);

		await mockUserList(page, []);
		await mockShelters(page);
		await page.goto('http://localhost:4173/back-office/users');

		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();

		await expect(page.getByRole('dialog')).toBeVisible();
		await page.locator('input[name="username"]').fill(newUsername);
		await page.locator('input[name="password"]').fill('TestPass1234!');
		await page.locator('input[name="display_name"]').fill('New UI Staff');

		// SM can only create staff, shelter is fixed.
		await pickSelectOption(page, CAPABILITY_FIELD, 'เจ้าหน้าที่ครัว');

		await page.getByRole('button', { name: /บันทึก/ }).click();

		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(newUsername)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.roles).toContain('shelter:SH001'); // SM1's shelter
		expect(doc.roles).toContain('kitchen_staff');
		expect(doc.display_name).toBe('New UI Staff');
	});
});

// ─── EOC global users (unlocked picker) + shelter-edit lock ───────────────────

test.describe('User Management UI — EOC route', () => {
	test('SA can open EOC users and still pick a shelter when creating', async ({ page }) => {
		const newUsername = `ui_eoc_sm_${RUN_ID}`;
		createdDuringTest.push(newUsername);

		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, []);
		await mockShelters(page, [{ code: 'SH001', name: 'Test Shelter' }]);
		await page.goto('http://localhost:4173/portal/system-management/users');

		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('combobox', { name: SHELTER_FIELD })).toBeVisible();

		await page.locator('input[name="username"]').fill(newUsername);
		await page.locator('input[name="password"]').fill('TestPass1234!');
		await page.locator('input[name="display_name"]').fill('EOC UI SM');
		await pickSelectOption(page, CAPABILITY_FIELD, 'ผู้จัดการศูนย์');
		await pickSelectOption(page, SHELTER_FIELD, /SH001/);
		await page.getByRole('button', { name: /บันทึก/ }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(newUsername)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.roles).toContain('shelter:SH001');
		expect(doc.roles).toContain('shelter_manager');
	});

	test('SM is redirected away from the EOC users URL', async ({ page }) => {
		await injectSession(page, SM1, sessions[SM1.name]);
		await page.goto('http://localhost:4173/portal/system-management/users');
		await page.waitForURL((url) => !url.pathname.includes('/system-management/users'), {
			timeout: 8000
		});
		await expect(page).toHaveURL('http://localhost:4173/portal');
	});
});

test.describe('User Management UI — Shelter edit (locked)', () => {
	test('SA creates a user from EOC shelter edit without a shelter picker', async ({ page }) => {
		const CODE = 'SH001';
		const newUsername = `ui_edit_lock_${RUN_ID}`;
		createdDuringTest.push(newUsername);

		await injectSession(page, SA, sessions[SA.name]);
		await mockUserList(page, []);
		await mockShelters(page, [{ code: CODE, name: 'Test Shelter' }]);
		await page.goto(`http://localhost:4173/portal/system-management/shelters/edit/${CODE}`);

		await page.getByRole('button', { name: 'ผู้ใช้งานและสิทธิ์' }).click();
		await page.getByRole('button', { name: /เพิ่มผู้ใช้/ }).click();

		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('combobox', { name: SHELTER_FIELD })).toHaveCount(0);
		await expect(page.getByRole('dialog').getByText(CODE)).toBeVisible();

		await page.locator('input[name="username"]').fill(newUsername);
		await page.locator('input[name="password"]').fill('TestPass1234!');
		await page.locator('input[name="display_name"]').fill('Locked Shelter User');
		await pickSelectOption(page, CAPABILITY_FIELD, 'ผู้จัดการศูนย์');
		await page.getByRole('button', { name: /บันทึก/ }).click();
		await expect(page.getByRole('dialog')).not.toBeVisible({ timeout: 8000 });

		const auth = COUCH_AUTH;
		const check = await fetch(
			`http://localhost:5984/_users/org.couchdb.user:${encodeURIComponent(newUsername)}`,
			{ headers: { Authorization: auth } }
		);
		expect(check.status).toBe(200);
		const doc = await check.json();
		expect(doc.roles).toContain(`shelter:${CODE}`);
		expect(doc.roles).toContain('shelter_manager');
		expect(doc.display_name).toBe('Locked Shelter User');
	});
});
