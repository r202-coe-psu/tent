import { test, expect, type Locator, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	SM_SH001_ROLES,
	SM_SH002_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';
import { CAN_WRITE } from './helpers/e2e-env';
import {
	MOCK_DEST,
	MOCK_SHELTER,
	mockReferralApi,
	mockStaffSession,
	newReferralStore,
	referralFixture,
	type ReferralStore
} from './helpers/referral-mock';

const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);
const MOCK_USER = 'ref_mock_manager';

/**
 * Sign in as a shelter manager for `shelter` with every CouchDB and BFF call answered by
 * route mocks. The page's auth guard reads the cached identity from localStorage.
 */
async function signInMocked(page: Page, store: ReferralStore, shelter = MOCK_SHELTER) {
	await mockStaffSession(page, shelter);
	await mockReferralApi(page, store);
	await injectSession(
		page,
		{ name: MOCK_USER, roles: [`shelter:${shelter}`, 'shelter_manager'] },
		'mock-session'
	);
}

/** Press Tab until `target` has focus (keyboard only). */
async function tabTo(page: Page, target: Locator, maxTabs = 80): Promise<void> {
	for (let i = 0; i < maxTabs; i++) {
		const focused = await target.evaluate((el) => el === document.activeElement).catch(() => false);
		if (focused) return;
		await page.keyboard.press('Tab');
	}
	throw new Error('target never received keyboard focus');
}

/** Each mocked test runs with no uncaught page errors (hygiene, README §5). */
function trackPageErrors(page: Page): string[] {
	const errors: string[] = [];
	page.on('pageerror', (e) => errors.push(e.message));
	return errors;
}

test.describe('Referrals — mocked UI contracts', { tag: ['@regression', '@back-office'] }, () => {
	let pageErrors: string[] = [];

	test.beforeEach(async ({ page }) => {
		pageErrors = trackPageErrors(page);
	});

	test.afterEach(async ({ page }) => {
		await clearSession(page);
		expect(pageErrors).toEqual([]);
	});

	// -----------------------------------------------------------------------
	// #548 — list cap banner, list/detail error states
	// -----------------------------------------------------------------------

	test('#548 list load failure shows an error with retry, never the empty state', async ({
		page
	}) => {
		const store = newReferralStore();
		store.listFail = true;
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		const alert = page.getByRole('alert').filter({ hasText: 'โหลดรายการส่งต่อไม่สำเร็จ' });
		await expect(alert).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText('ไม่พบข้อมูลรายการส่งต่อ')).toHaveCount(0);

		// Recover: the endpoint is healthy again and the retry button brings the rows back.
		store.listFail = false;
		store.referrals['referral:mock_retry'] = referralFixture({ _id: 'referral:mock_retry' });
		await alert.getByRole('button', { name: 'ลองใหม่' }).click();
		await expect(page.getByRole('button', { name: /สมชาย ทดสอบ/ })).toBeVisible();
		await expect(alert).toHaveCount(0);
	});

	test('#548 shows the 50-row ceiling notice when the list is full', async ({ page }) => {
		const store = newReferralStore(
			Array.from({ length: 50 }, (_, i) =>
				referralFixture({
					_id: `referral:mock_cap_${i}`,
					reason: `เหตุผล ${i}`,
					evacuee_summary: { first_name: 'ผู้ประสบภัย', last_name: `ลำดับ ${i}` }
				})
			)
		);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await expect(page.getByRole('group', { name: 'กรองตามสถานะ' })).toBeVisible();
		await expect(page.getByText('แสดง 50 รายการล่าสุด')).toBeVisible();
	});

	test('#548 no ceiling notice below 50 rows', async ({ page }) => {
		const store = newReferralStore(
			Array.from({ length: 49 }, (_, i) =>
				referralFixture({ _id: `referral:mock_below_${i}`, reason: `เหตุผล ${i}` })
			)
		);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await expect(page.getByRole('group', { name: 'กรองตามสถานะ' })).toBeVisible();
		await expect(page.getByText(/แสดง \d+ รายการล่าสุด/)).toHaveCount(0);
	});

	test('#548 detail load failure shows an error with retry and a way back', async ({ page }) => {
		const store = newReferralStore([
			referralFixture({ _id: 'referral:mock_detail', status: 'accepted' })
		]);
		store.detailFail = true;
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();
		const alert = page.getByRole('alert').filter({ hasText: 'โหลดประวัติการส่งต่อไม่สำเร็จ' });
		await expect(alert).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText('ไม่พบรายการส่งต่อนี้')).toHaveCount(0);

		store.detailFail = false;
		await alert.getByRole('button', { name: 'ลองใหม่' }).click();
		await expect(page.getByTestId('btn-close-referral')).toBeVisible();
	});

	test('#548 detail failure can return to the list', async ({ page }) => {
		const store = newReferralStore([referralFixture({ _id: 'referral:mock_back' })]);
		store.detailFail = true;
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();
		const alert = page.getByRole('alert').filter({ hasText: 'โหลดประวัติการส่งต่อไม่สำเร็จ' });
		await expect(alert).toBeVisible({ timeout: 20_000 });
		await alert.getByRole('button', { name: 'กลับไปหน้ารายการ' }).click();
		await expect(alert).toHaveCount(0);
		await expect(page.getByRole('group', { name: 'กรองตามสถานะ' })).toBeVisible();
	});

	// -----------------------------------------------------------------------
	// #550 — no-selection guard, single request while a transition is in flight
	// -----------------------------------------------------------------------

	test('#550 submitting without an evacuee shows the message and sends nothing', async ({
		page
	}) => {
		const store = newReferralStore();
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await page.getByRole('button', { name: /สร้างรายการส่งต่อ/ }).click();
		await expect(page.getByText('สร้างรายการส่งต่อผู้ประสบภัย')).toBeVisible();

		for (const name of [/^ส่งข้อมูล$/, /^บันทึกร่าง$/]) {
			await page.getByRole('button', { name }).click();
			await expect(page.getByText('กรุณาเลือกผู้ประสบภัยอย่างน้อย 1 คน').first()).toBeVisible();
		}
		expect(store.writes).toEqual([]);
	});

	test('#550 a transition in flight disables its controls and sends one request', async ({
		page
	}) => {
		const store = newReferralStore([
			referralFixture({ _id: 'referral:mock_dbl', status: 'accepted' })
		]);
		let release!: () => void;
		store.patchGate = new Promise<void>((resolve) => (release = resolve));
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');

		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();
		const trigger = page.getByTestId('btn-close-referral');
		await trigger.click();
		const dialog = page.getByRole('alertdialog');
		const confirm = dialog.getByRole('button', { name: 'ปิดรายการ', exact: true });
		await confirm.dblclick();

		await expect(confirm).toBeDisabled();
		// The detail's own trigger must also be locked while the request is in flight (#550 F-50).
		await expect(trigger).toBeDisabled();
		await expect.poll(() => store.patches.length).toBe(1);
		release();
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ปิดรายการ" สำเร็จ')).toBeVisible();
		expect(store.patches).toHaveLength(1);
		expect(store.patches[0].body.to).toBe('closed');
	});

	// -----------------------------------------------------------------------
	// #549 — confirm dialogs before irreversible actions
	// -----------------------------------------------------------------------

	test('#549 cancel draft: cancel sends nothing, confirm closes the draft', async ({ page }) => {
		const store = newReferralStore([
			referralFixture({ _id: 'referral:mock_draft', status: 'draft', timeline: {} })
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();

		await page.getByRole('button', { name: 'ยกเลิกร่าง', exact: true }).click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('ยืนยันการยกเลิกร่าง')).toBeVisible();
		await expect(dialog.getByText('จำนวน 1 รายการ')).toBeVisible();
		await expect(dialog.getByText('ผู้ประสบภัย: สมชาย ทดสอบ')).toBeVisible();
		await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
		await expect(dialog).toHaveCount(0);
		expect(store.patches).toHaveLength(0);
		await expect(page.getByRole('button', { name: /ส่งออกข้อมูล/ })).toBeVisible();

		await page.getByRole('button', { name: 'ยกเลิกร่าง', exact: true }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'ยกเลิกร่าง', exact: true })
			.click();
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ยกเลิกร่าง" สำเร็จ')).toBeVisible();
		expect(store.patches).toHaveLength(1);
		expect(store.patches[0].body.to).toBe('closed');
	});

	test('#549 send: cancel sends nothing, confirm sends the draft', async ({ page }) => {
		const store = newReferralStore([
			referralFixture({ _id: 'referral:mock_send', status: 'draft', timeline: {} })
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();

		await page.getByRole('button', { name: /ส่งออกข้อมูล/ }).click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('ยืนยันการส่งตัว')).toBeVisible();
		await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
		expect(store.patches).toHaveLength(0);

		await page.getByRole('button', { name: /ส่งออกข้อมูล/ }).click();
		await page
			.getByRole('alertdialog')
			.getByRole('button', { name: 'ส่งตัว', exact: true })
			.click();
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ส่งตัว" สำเร็จ')).toBeVisible();
		expect(store.patches.map((p) => p.body.to)).toEqual(['sent']);
	});

	test('#549 close dialog is readable and tappable on a phone viewport', async ({ page }) => {
		await page.setViewportSize({ width: 390, height: 844 });
		const store = newReferralStore([
			referralFixture({ _id: 'referral:mock_mobile', status: 'accepted' })
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();

		await page.getByTestId('btn-close-referral').click();
		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('จำนวน 1 รายการ')).toBeVisible();
		await expect(dialog.getByText('ผู้ประสบภัย: สมชาย ทดสอบ')).toBeVisible();

		for (const name of ['ยกเลิก', 'ปิดรายการ']) {
			const button = dialog.getByRole('button', { name, exact: true });
			const box = await button.boundingBox();
			expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
		}
	});

	test('#549 accept: the reason goes into the dialog, cancel sends nothing', async ({ page }) => {
		// Incoming: created at SH002 for SH001 (the actor) to accept or reject.
		const store = newReferralStore([
			referralFixture({
				_id: 'referral:mock_incoming',
				shelter_code: MOCK_DEST,
				to_shelter_code: MOCK_SHELTER,
				created_by: 'ref_mock_dest'
			})
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();

		await page.getByRole('button', { name: /ตอบรับการส่งต่อ/ }).click();
		await page.getByPlaceholder('ระบุเหตุผลหรือคำอธิบายประกอบการพิจารณา...').fill('มีที่ว่าง');
		await page.getByRole('button', { name: 'ยืนยันการตอบรับ', exact: true }).click();

		const dialog = page.getByRole('alertdialog');
		await expect(dialog.getByText('ยืนยันการตอบรับ')).toBeVisible();
		await expect(dialog.getByText('เหตุผลนี้จะใช้กับ 1 รายการ: มีที่ว่าง')).toBeVisible();
		await dialog.getByRole('button', { name: 'ยกเลิก', exact: true }).click();
		expect(store.patches).toHaveLength(0);

		await page.getByRole('button', { name: 'ยืนยันการตอบรับ', exact: true }).click();
		await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยันตอบรับ' }).click();
		await expect(page.getByText('เปลี่ยนสถานะเป็น "ตอบรับ" สำเร็จ')).toBeVisible();
		expect(store.patches).toEqual([
			{ id: 'referral:mock_incoming', body: { to: 'accepted', reason: 'มีที่ว่าง' } }
		]);
	});

	// -----------------------------------------------------------------------
	// #556 — keyboard use and semantics
	// -----------------------------------------------------------------------

	test('#556 keyboard only: open a batch, select a row, open its detail', async ({ page }) => {
		const shared = {
			reason: 'ศูนย์เต็ม ชุดทดสอบ',
			created_at: '2026-10-14T08:00:00.000Z',
			updated_at: '2026-10-14T08:00:00.000Z'
		};
		const store = newReferralStore([
			referralFixture({
				_id: 'referral:mock_kb_a',
				status: 'accepted',
				...shared,
				evacuee_summary: { first_name: 'สมหญิง', last_name: 'ก' }
			}),
			referralFixture({
				_id: 'referral:mock_kb_b',
				status: 'accepted',
				...shared,
				evacuee_summary: { first_name: 'สมศรี', last_name: 'ข' }
			})
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await expect(page.getByRole('group', { name: 'กรองตามสถานะ' })).toBeVisible();

		// Nested interactive content: a button inside a button is invalid HTML.
		await expect(page.locator('button button')).toHaveCount(0);

		const batch = page.getByRole('button', { name: /ชุดส่งต่อ 2 คน/ });
		await tabTo(page, batch);
		await page.keyboard.press('Enter');

		const row = page.getByRole('row', { name: /สมหญิง ก/ });
		await tabTo(page, row);
		await page.keyboard.press('Enter');
		await expect(page.getByTestId('btn-close-referral')).toBeVisible();
	});

	test('#556 status filter buttons expose their state with aria-pressed', async ({ page }) => {
		const store = newReferralStore([referralFixture({ _id: 'referral:mock_filter' })]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		const tabs = page.getByRole('group', { name: 'กรองตามสถานะ' }).getByRole('button');
		await expect(tabs.first()).toBeVisible();

		const count = await tabs.count();
		expect(count).toBeGreaterThan(1);
		await expect(tabs.first()).toHaveAttribute('aria-pressed', 'true');

		await tabTo(page, tabs.nth(1));
		await page.keyboard.press('Space');
		await expect(tabs.nth(1)).toHaveAttribute('aria-pressed', 'true');
		await expect(tabs.first()).toHaveAttribute('aria-pressed', 'false');
	});

	test.fixme('GAP: F-49 detail reason prompt does not move focus to its input', async ({
		page
	}) => {
		const store = newReferralStore([
			referralFixture({
				_id: 'referral:mock_focus',
				shelter_code: MOCK_DEST,
				to_shelter_code: MOCK_SHELTER,
				created_by: 'ref_mock_dest'
			})
		]);
		await signInMocked(page, store);
		await page.goto('/back-office/referrals');
		await page.getByRole('button', { name: /สมชาย ทดสอบ/ }).click();
		await page.getByRole('button', { name: /ตอบรับการส่งต่อ/ }).click();
		await expect(page.getByPlaceholder('ระบุเหตุผลหรือคำอธิบายประกอบการพิจารณา...')).toBeFocused();
	});
});

// ---------------------------------------------------------------------------
// Live flow — QUARANTINED (README §4.7).
// Writes outside this run's RUN_ID: it PUTs and DELETEs `registry/shelter:SH002` (a seeded
// shelter id), writes into the seeded `shelter_sh001` DB, and tears down by `_find` query.
// Kept out of default runs until it is rewritten on RUN_ID-scoped fixtures.
// ---------------------------------------------------------------------------

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

test.describe(
	'Referrals Flow — live (quarantined)',
	{ tag: ['@quarantine', '@critical', '@back-office'] },
	() => {
		test.beforeAll(async () => {
			await couchReq('PUT', `/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}`, MOCK_EVACUEE);
			await couchReq('PUT', `/registry/shelter:SH002`, SH002);
			await createCouchUser(SM1);
			await createCouchUser(SM2);
			sessions[SM1.name] = await couchLogin(SM1.name, SM1.password);
			sessions[SM2.name] = await couchLogin(SM2.name, SM2.password);
		});

		test.afterAll(async () => {
			await deleteCouchUser(SM1.name);
			await deleteCouchUser(SM2.name);
			const evDoc = await couchReq('GET', `/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}`);
			if (evDoc.status === 200 && evDoc.data) {
				await couchReq(
					'DELETE',
					`/shelter_sh001/${encodeURIComponent(MOCK_EVACUEE_ID)}?rev=${(evDoc.data as { _rev: string })._rev}`
				);
			}
			const shDoc = await couchReq('GET', `/registry/shelter:SH002`);
			if (shDoc.status === 200 && shDoc.data) {
				await couchReq(
					'DELETE',
					`/registry/shelter:SH002?rev=${(shDoc.data as { _rev: string })._rev}`
				);
			}
			const query = { selector: { type: 'referral', evacuee_id: MOCK_EVACUEE_ID } };
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

		test('Full Flow: Create from Source -> Verify -> Accept from Destination', async ({ page }) => {
			test.setTimeout(90000);
			// STEP 1: Source Shelter creates a referral
			await injectSession(page, SM1, sessions[SM1.name]);
			await page.goto('/back-office/referrals');
			await page.getByRole('button', { name: /สร้างรายการส่งต่อ/ }).click();
			await expect(page.getByText('สร้างรายการส่งต่อผู้ประสบภัย')).toBeVisible();
			await page.getByRole('button', { name: /ย้ายศูนย์พักพิง/ }).click();
			await expect(page.getByText('ศูนย์พักพิงปลายทาง')).toBeVisible();
			await page.getByPlaceholder('เลือกศูนย์พักพิงปลายทาง...').click();
			await page.getByRole('option', { name: /sh002/i }).click();
			await page.getByPlaceholder('ค้นหาชื่อ หรือเบอร์โทร...').fill(MOCK_EVACUEE.first_name);
			const row = page.getByRole('row', { name: new RegExp(MOCK_EVACUEE.first_name, 'i') });
			await expect(row).toBeVisible();
			await row.click();
			await page
				.getByPlaceholder('ระบุรายละเอียดเหตุผลความจำเป็นในการส่งต่อผู้ประสบภัย')
				.fill('ศูนย์เต็ม');
			await page.getByRole('button', { name: 'ส่งข้อมูล' }).click();
			// #549: sending asks for confirmation first.
			await page
				.getByRole('alertdialog')
				.getByRole('button', { name: /^สร้างและส่ง/ })
				.click();
			await expect(page.getByText(/ส่งข้อมูลสำเร็จ/)).toBeVisible();

			// STEP 2: Destination Shelter receives and accepts
			await clearSession(page);
			await injectSession(page, SM2, sessions[SM2.name]);
			await page.goto('/back-office/referrals');
			const refItem = page.locator('button').filter({ hasText: 'ศูนย์เต็ม' }).first();
			await expect(refItem).toBeVisible();
			await refItem.click();
			await page.getByRole('button', { name: 'ตอบรับการส่งต่อ (Accept)' }).click();
			await page.getByRole('button', { name: 'ยืนยันการตอบรับ', exact: true }).click();
			await page.getByRole('alertdialog').getByRole('button', { name: 'ยืนยันตอบรับ' }).click();
			await expect(page.getByText('เปลี่ยนสถานะเป็น "ตอบรับ" สำเร็จ')).toBeVisible();

			// STEP 3: Source Shelter closes the referral
			await clearSession(page);
			await injectSession(page, SM1, sessions[SM1.name]);
			await page.goto('/back-office/referrals');
			const acceptedItem = page.locator('button').filter({ hasText: 'ศูนย์เต็ม' }).first();
			await expect(acceptedItem).toBeVisible();
			await acceptedItem.click();
			const closeButton = page.getByTestId('btn-close-referral');
			await expect(closeButton).toBeVisible({ timeout: 10000 });
			await closeButton.click();
			await page
				.getByRole('alertdialog')
				.getByRole('button', { name: 'ปิดรายการ', exact: true })
				.click();
			await expect(page.getByText(/เปลี่ยนสถานะเป็น "ปิดรายการ"/)).toBeVisible({ timeout: 10000 });
		});
	}
);

// ---------------------------------------------------------------------------
// #559 — accept is refused unless the referral is `sent`, and moves no evacuee.
// Live but RUN_ID-scoped: every doc written here is recorded in `ledger` and deleted in
// afterAll; a zero-leak check confirms nothing is left. Writes never touch SH001-SH004 docs.
// ---------------------------------------------------------------------------

test.describe(
	'Referrals — accept guard (live API, RUN_ID-scoped)',
	{ tag: ['@critical', '@back-office'] },
	() => {
		test.skip(!CAN_WRITE, 'live writes need a writable target (CAN_WRITE)');

		const dest = {
			name: `ref_559_dest_${RUN_ID}`,
			password: 'Password1!',
			roles: SM_SH002_ROLES,
			display_name: 'Accept-guard dest'
		};
		const evacueeId = `evacuee:e2e_559_${RUN_ID}`;
		const ledger: { db: string; id: string }[] = [];
		let destCookie = '';

		test.beforeAll(async () => {
			await createCouchUser(dest);
			destCookie = await couchLogin(dest.name, dest.password);
			const evacuee = { ...MOCK_EVACUEE, _id: evacueeId, first_name: `E2E559_${RUN_ID}` };
			const res = await couchReq('PUT', `/shelter_sh001/${encodeURIComponent(evacueeId)}`, evacuee);
			if (res.status === 201) ledger.push({ db: 'shelter_sh001', id: evacueeId });
		});

		test.afterAll(async () => {
			for (const entry of [...ledger].reverse()) {
				const doc = await couchReq('GET', `/${entry.db}/${encodeURIComponent(entry.id)}`);
				const rev = (doc.data as { _rev?: string })._rev;
				if (doc.status === 200 && rev) {
					await couchReq('DELETE', `/${entry.db}/${encodeURIComponent(entry.id)}?rev=${rev}`);
				}
			}
			await deleteCouchUser(dest.name);
			for (const entry of ledger) {
				const left = await couchReq('GET', `/${entry.db}/${encodeURIComponent(entry.id)}`);
				expect(left.status, `zero-leak: ${entry.db}/${entry.id}`).toBe(404);
			}
		});

		for (const status of ['rejected', 'accepted'] as const) {
			test(`accept on a ${status} referral returns 422 and moves no evacuee`, async ({
				request
			}) => {
				const refId = `referral:e2e_559_${status}_${RUN_ID}`;
				const doc = referralFixture({
					_id: refId,
					status,
					evacuee_id: evacueeId,
					shelter_code: 'SH001',
					to_shelter_code: MOCK_DEST,
					reason: `E2E559 ${RUN_ID}`,
					created_by: 'ref_559_source',
					timeline: {}
				});
				const put = await couchReq('PUT', `/central_ops/${encodeURIComponent(refId)}`, doc);
				expect(put.status).toBe(201);
				ledger.push({ db: 'central_ops', id: refId });
				// A regressed accept would copy the evacuee and write transfer movements. Ledger those
				// ids up front, so teardown and the zero-leak check cover them even when the test fails.
				const suffix = refId.replace('referral:', '');
				ledger.push(
					{ db: 'shelter_sh002', id: evacueeId },
					{ db: 'shelter_sh002', id: `movement:capacity_transfer_in:${suffix}` },
					{ db: 'shelter_sh001', id: `movement:capacity_transfer_out:${suffix}` }
				);

				const res = await request.patch(
					`/api/back-office/referral/${encodeURIComponent(refId)}/transition?shelter_code=${MOCK_DEST}`,
					{
						headers: { Cookie: `AuthSession=${destCookie}`, 'Content-Type': 'application/json' },
						data: { to: 'accepted' }
					}
				);
				expect(res.status()).toBe(422);

				const source = await couchReq('GET', `/shelter_sh001/${encodeURIComponent(evacueeId)}`);
				expect((source.data as { shelter_code: string }).shelter_code).toBe('SH001');
				const moved = await couchReq('GET', `/shelter_sh002/${encodeURIComponent(evacueeId)}`);
				expect(moved.status).toBe(404);
				const after = await couchReq('GET', `/central_ops/${encodeURIComponent(refId)}`);
				expect((after.data as { status: string }).status).toBe(status);
			});
		}
	}
);
