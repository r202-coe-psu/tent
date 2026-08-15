import { test, expect } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	SM_SH001_ROLES,
	SM_SH002_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const SM1 = {
	name: `ref_sm1_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Source SM'
};
const SM2 = {
	name: `ref_sm2_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH002_ROLES,
	display_name: 'Dest SM'
};

const sessions: Record<string, string> = {};

// Mock Data
const MOCK_EVACUEE_ID = `evacuee:mock_${RUN_ID}`;
const MOCK_EVACUEE = {
	_id: MOCK_EVACUEE_ID,
	type: 'evacuee',
	schema_v: 1,
	first_name: `TestName_${RUN_ID}`,
	last_name: 'ผู้ประสบภัย',
	shelter_code: 'SH001',
	created_at: new Date().toISOString(),
	updated_at: new Date().toISOString(),
	created_by: 'system',
	current_stay: { status: 'active' }
};

const SH002 = {
	_id: 'shelter:SH002',
	type: 'shelter',
	schema_v: 4,
	code: 'SH002',
	name: 'Shelter 2',
	operation_status: 'open'
};

test.beforeAll(async () => {
	// 1. Create databases if not exist
	await couchReq('PUT', '/central_ops');
	await couchReq('PUT', '/shelter_sh001');
	await couchReq('PUT', '/shelter_sh002');
	await couchReq('PUT', '/_master_shelters');

	// 2. Insert mock evacuee to source shelter
	await couchReq('PUT', `/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}`, MOCK_EVACUEE);

	// 3. Insert mock shelter to master list for combobox
	await couchReq('PUT', `/_master_shelters/shelter:SH002`, SH002);

	// 4. Create users
	await createCouchUser(SM1);
	await createCouchUser(SM2);
	sessions[SM1.name] = await couchLogin(SM1.name, SM1.password);
	sessions[SM2.name] = await couchLogin(SM2.name, SM2.password);
});

test.afterAll(async () => {
	await deleteCouchUser(SM1.name);
	await deleteCouchUser(SM2.name);

	// Cleanup DBs
	const evDoc = await couchReq('GET', `/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}`);
	if (evDoc.status === 200 && evDoc.data) {
		await couchReq(
			'DELETE',
			`/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}?rev=${(evDoc.data as { _rev: string })._rev}`
		);
	}

	const shDoc = await couchReq('GET', `/_master_shelters/shelter:SH002`);
	if (shDoc.status === 200 && shDoc.data) {
		await couchReq(
			'DELETE',
			`/_master_shelters/shelter:SH002?rev=${(shDoc.data as { _rev: string })._rev}`
		);
	}

	// Find and delete the created referral from central_ops
	const query = {
		selector: { type: 'referral', evacuee_id: MOCK_EVACUEE_ID }
	};
	const res = await couchReq('POST', '/central_ops/_find', query);
	if (res.status === 200 && (res.data as { docs: { _id: string; _rev: string }[] }).docs) {
		for (const doc of (res.data as { docs: { _id: string; _rev: string }[] }).docs) {
			await couchReq('DELETE', `/central_ops/${encodeURIComponent(doc._id)}?rev=${doc._rev}`);
		}
	}
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Referrals Flow — E2E UI Tests', () => {
	test('Full Flow: Create from Source -> Verify -> Accept from Destination', async ({ page }) => {
		test.setTimeout(90000);
		page.on('console', (msg) => console.log('BROWSER CONSOLE:', msg.type(), msg.text()));

		// ==========================================
		// STEP 1: Source Shelter creates a referral
		// ==========================================
		await injectSession(page, SM1, sessions[SM1.name]);
		await page.goto('/back-office/referrals');

		// Click create new referral button
		await page.getByRole('button', { name: /สร้างรายการส่งต่อ/ }).click();

		// Ensure modal or page opens
		await expect(page.getByText('สร้างรายการส่งต่อผู้ประสบภัย')).toBeVisible();

		// Select 'Capacity' referral type
		await page.getByRole('button', { name: /ย้ายศูนย์พักพิง/ }).click();

		// Ensure capacity form is rendered
		await expect(page.getByText('ศูนย์พักพิงปลายทาง')).toBeVisible();

		// Fill out the form
		await page.getByPlaceholder('เลือกศูนย์พักพิงปลายทาง...').click();
		await page.getByRole('option', { name: /sh002/i }).click(); // Select sh002

		// Search and pick evacuee
		await page.getByPlaceholder('ค้นหาชื่อ หรือเบอร์โทร...').fill(MOCK_EVACUEE.first_name);

		// Verify mock evacuee appears and select them
		const row = page.getByRole('row', { name: new RegExp(MOCK_EVACUEE.first_name, 'i') });
		await expect(row).toBeVisible();
		await row.click();

		// Fill required reason field
		await page
			.getByPlaceholder('ระบุรายละเอียดเหตุผลความจำเป็นในการส่งต่อผู้ประสบภัย')
			.fill('ศูนย์เต็ม');

		// Submit form
		await page.getByRole('button', { name: 'ส่งข้อมูล' }).click();

		// Assert success toast
		await expect(page.getByText(/ส่งข้อมูลสำเร็จ/)).toBeVisible();

		// ==========================================
		// STEP 2: Destination Shelter receives and accepts
		// ==========================================
		// Clear session and login as destination shelter manager
		await clearSession(page);
		await injectSession(page, SM2, sessions[SM2.name]);
		await page.goto('/back-office/referrals');

		// The list should show the incoming referral, click it.
		// Note: Destination shelter cannot see evacuee name until accepted, so we search by reason.
		const refItem = page.locator('button').filter({ hasText: 'ศูนย์เต็ม' }).first();
		await expect(refItem).toBeVisible();
		await refItem.click();

		// Accept referral
		await page.getByRole('button', { name: 'ตอบรับการส่งต่อ (Accept)' }).click();
		await page.getByRole('button', { name: 'ยืนยันการตอบรับ' }).click();

		// Assert success transition
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ตอบรับ" สำเร็จ')).toBeVisible();

		// ==========================================
		// STEP 3: Destination Shelter closes the referral
		// ==========================================

		// Wait for the previous toast to disappear to prevent click interception
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ตอบรับ" สำเร็จ')).toBeHidden({ timeout: 10000 });

		// Wait for the UI to update and show the close button
		const closeButton = page.getByTestId('btn-close-referral');
		await expect(closeButton).toBeVisible({ timeout: 10000 });
		await closeButton.click();

		// Assert success transition to closed
		await expect(page.getByText(/เปลี่ยนสถานะเป็น "ปิดรายการ"/)).toBeVisible({ timeout: 10000 });
	});
});
