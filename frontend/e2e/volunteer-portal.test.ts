import { test, expect, type Page } from '@playwright/test';

/**
 * Volunteer Access Portal + ตารางทำงานจิตอาสา (CR-092 หน้าจอ 2 + 6).
 *
 * A volunteer has no account: they sign in with the phone number they applied with, or
 * with a ticket code. These tests cover that entry point, the schedule it opens, and the
 * read-only rule option C settled — a phone lookup may read a pass but never cancel one.
 */

const PHONE = '0891112222';
const TRACKING_TOKEN = 'TKT-VOL-1234567890ABCDEF1234567890ABCDEF';
const VIEW_TOKEN = 'VIEW-am9iX2FwcGxpY2F0aW9uOjAxQQ.c2lnbmF0dXJl';

/** Two shifts ahead and one behind, so the split into upcoming / history is exercised. */
const SCHEDULE = {
	success: true,
	shifts: [
		{
			assignment_id: 'shift_assignment:01UPCOMING',
			job_id: 'job:01JOB',
			job_title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			date: '2099-09-01',
			shift: 'custom',
			station: 'ครัวกลาง',
			start_ts: '2099-09-01T01:00:00Z',
			end_ts: '2099-09-01T05:00:00Z',
			check_in_at: null,
			check_out_at: null,
			status: 'assigned',
			// The offer the Dispatch Card is built around.
			dispatch_status: 'dispatched'
		},
		{
			assignment_id: 'shift_assignment:01STANDBY',
			job_id: 'job:01JOB',
			job_title: 'เจ้าหน้าที่ช่วยลงทะเบียนผู้ประสบภัย',
			shelter_code: 'SH002',
			shelter_name: 'ศูนย์พักพิง โรงเรียนวัดโคกสมานคุณ',
			date: '2099-09-03',
			shift: 'custom',
			station: 'จุดลงทะเบียน',
			start_ts: '2099-09-03T02:00:00Z',
			end_ts: '2099-09-03T08:00:00Z',
			check_in_at: null,
			check_out_at: null,
			status: 'standby',
			dispatch_status: 'accepted'
		},
		{
			assignment_id: 'shift_assignment:01DONE',
			job_id: 'job:01JOB',
			job_title: 'ทีมยกของและจัดเรียงคลังสิ่งของบริจาค',
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			date: '2020-08-26',
			shift: 'custom',
			station: 'คลังสิ่งของ',
			start_ts: '2020-08-26T01:00:00Z',
			end_ts: '2020-08-26T05:00:00Z',
			check_in_at: '2020-08-26T01:05:00Z',
			check_out_at: '2020-08-26T05:00:00Z',
			status: 'completed',
			dispatch_status: 'accepted'
		}
	]
};

const TICKETS = {
	success: true,
	tickets: [
		{
			view_token: VIEW_TOKEN,
			status: 'confirmed',
			job_title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
			shelter_code: 'SH001',
			shift_date: '2099-09-01'
		}
	]
};

function ticket(overrides: Record<string, unknown> = {}) {
	return {
		success: true,
		ticket: {
			token: TRACKING_TOKEN,
			can_cancel: true,
			status: 'confirmed',
			job_id: 'job:01JOB',
			job_title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
			shelter_code: 'SH001',
			shelter_name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
			applicant_name: 'อาสา ทดสอบ',
			phone_masked: 'xxx-xxx-2222',
			skills: ['ครัว'],
			selected_shift: {
				date: '2099-09-01',
				start_time: '08:00',
				end_time: '12:00',
				station: 'ครัวกลาง'
			},
			applied_at: '2026-08-28T03:00:00Z',
			qr_payload: `/volunteer/ticket/${TRACKING_TOKEN}`,
			...overrides
		}
	};
}

const json = (body: unknown, status = 200) => ({
	status,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

async function mockPortalApi(page: Page) {
	await page.route('**/api/public/v1/volunteer/schedule/respond', (route) =>
		route.fulfill(json({ success: true, assignment_id: 'x', dispatch_status: 'accepted' }))
	);
	await page.route('**/api/public/v1/volunteer/schedule', (route) => route.fulfill(json(SCHEDULE)));
	await page.route('**/api/public/v1/volunteer/ticket/find', (route) =>
		route.fulfill(json(TICKETS))
	);
}

/** Open the portal tab — it is the second tab, not the landing one. */
async function openPortalTab(page: Page) {
	await page.goto('/volunteers/portal?tab=portal');
	await expect(page.locator('#volunteer-phone-input')).toBeVisible();
}

/** Sign in with a phone number. Fixture numbers open the demo; others go live. */
async function signIn(page: Page, value: string) {
	await page.locator('#volunteer-phone-input').fill(value);
	await page.getByRole('button', { name: 'เข้าสู่ระบบทันที' }).click();
}

/** Sign in with a ticket code, on the portal's second login tab. */
async function signInWithToken(page: Page, value: string) {
	await page.getByRole('button', { name: /สแกน QR ตั๋ว \/ รหัส Token/ }).click();
	await page.locator('#volunteer-token-input').fill(value);
	await page.getByRole('button', { name: 'เข้าสู่ระบบ', exact: true }).click();
}

/** The signed-in marker — the sign-out control is icon-only, so it goes by title. */
function signOutButton(page: Page) {
	return page.getByTitle('สลับบัญชี / ออกจากระบบ');
}

test.describe('Volunteer Access Portal (CR-092 หน้าจอ 6)', () => {
	test('a live phone number shows the roster the server holds', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);

		await expect(signOutButton(page)).toBeVisible();
		await expect(page.getByText('ผู้ช่วยครัวจัดเตรียมอาหาร')).toBeVisible();
		await expect(page.getByText('จุดปฏิบัติงาน: ครัวกลาง')).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่ช่วยลงทะเบียนผู้ประสบภัย')).toBeVisible();
	});

	test('every number goes to the server — there is no built-in fixture session', async ({
		page
	}) => {
		// The demonstration fixtures were removed once the portal was wired to the API.
		// A number the server does not know opens an empty dashboard, never a made-up one.
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule', (route) =>
			route.fulfill(json({ success: true, shifts: [] }))
		);
		await page.route('**/api/public/v1/volunteer/ticket/find', (route) =>
			route.fulfill(json({ success: true, tickets: [] }))
		);
		await openPortalTab(page);
		await signIn(page, '081-9992211');

		await expect(signOutButton(page)).toBeVisible();
		await expect(page.getByText('Heavy Lifting')).toHaveCount(0);
		await expect(page.getByText('นายเก่งกล้า')).toHaveCount(0);
	});

	test('accepts a phone number typed with separators', async ({ page }) => {
		let asked: string | null = null;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule', async (route) => {
			asked = route.request().postDataJSON()?.phone ?? null;
			await route.fulfill(json(SCHEDULE));
		});
		await openPortalTab(page);
		await signIn(page, '089-111-2222');

		// Normalised before it becomes the session key.
		await expect.poll(() => asked).toBe(PHONE);
	});

	test('rejects something that is neither a phone number nor a fixture', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, '12345');

		await expect(page.getByText('เบอร์โทรศัพท์ไม่ถูกต้อง')).toBeVisible();
		await expect(signOutButton(page)).toHaveCount(0);
	});

	test('a ticket code goes straight to the pass without a lookup', async ({ page }) => {
		await mockPortalApi(page);
		await page.route(`**/api/public/v1/volunteer/ticket/${TRACKING_TOKEN}`, (route) =>
			route.fulfill(json(ticket()))
		);
		await openPortalTab(page);
		await signInWithToken(page, TRACKING_TOKEN);

		await expect(page).toHaveURL(new RegExp(`/volunteer/ticket/${TRACKING_TOKEN}$`));
	});

	test('signing out clears the session rather than leaving it on a shared tablet', async ({
		page
	}) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);
		await expect(signOutButton(page)).toBeVisible();

		await signOutButton(page).click();
		await expect(signOutButton(page)).toHaveCount(0);

		// Nothing about the last person may survive a reload on a shared device.
		await page.reload();
		await expect(signOutButton(page)).toHaveCount(0);
		await expect(page.locator('#volunteer-phone-input')).toHaveValue('');
	});
});

test.describe('Digital Pass (CR-092 หน้าจอ 2)', () => {
	test('renders the QR and never shows the national id or a raw phone', async ({ page }) => {
		await page.route(`**/api/public/v1/volunteer/ticket/${TRACKING_TOKEN}`, (route) =>
			route.fulfill(json(ticket()))
		);
		await page.goto(`/volunteer/ticket/${TRACKING_TOKEN}`);

		await expect(page.getByRole('img', { name: 'QR Code สำหรับรายงานตัวหน้างาน' })).toBeVisible();
		await expect(page.getByText('xxx-xxx-2222')).toBeVisible();
		// FR-VOL-03.4 — the ID number must not reach this page in any form.
		await expect(page.locator('body')).not.toContainText('1101700207030');
		await expect(page.locator('body')).not.toContainText(PHONE);
	});

	test('offers cancelling when opened with the applicant own token', async ({ page }) => {
		await page.route(`**/api/public/v1/volunteer/ticket/${TRACKING_TOKEN}`, (route) =>
			route.fulfill(json(ticket()))
		);
		await page.goto(`/volunteer/ticket/${TRACKING_TOKEN}`);

		await expect(page.getByRole('button', { name: /ขอยกเลิกการสมัครล่วงหน้า/ })).toBeVisible();
	});

	test('hides cancelling when opened through a phone lookup — option C', async ({ page }) => {
		await page.route(`**/api/public/v1/volunteer/ticket/${VIEW_TOKEN}`, (route) =>
			route.fulfill(json(ticket({ token: VIEW_TOKEN, can_cancel: false })))
		);
		await page.goto(`/volunteer/ticket/${VIEW_TOKEN}`);

		await expect(page.getByText('ผู้ช่วยครัวจัดเตรียมอาหาร')).toBeVisible();
		await expect(page.getByRole('button', { name: /ขอยกเลิกการสมัครล่วงหน้า/ })).toHaveCount(0);
	});

	test('says so when the token does not resolve', async ({ page }) => {
		await page.route('**/api/public/v1/volunteer/ticket/TKT-VOL-NOPE', (route) =>
			route.fulfill(json({ success: false, error: 'TICKET_NOT_FOUND' }, 404))
		);
		await page.goto('/volunteer/ticket/TKT-VOL-NOPE');

		await expect(page.getByText('ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง')).toBeVisible();
	});
});

test.describe('Portal BFF routes load server-side', () => {
	/**
	 * The tests above mock at `/api/**`, so none of them executes the BFF itself. That is
	 * exactly how a real bug shipped: both routes imported the feature barrel, which
	 * re-exports the Digital Pass, which pulls in `qrcode` — a CommonJS package that
	 * throws `ReferenceError: module is not defined` when SvelteKit evaluates it on the
	 * server. Every request 500'd while `check`, `lint` and the unit tests all passed.
	 *
	 * These call the routes for real. FastAPI is not running under Playwright, so the
	 * expected answer is the route's own upstream-failure envelope — what matters is that
	 * the module loaded and ran at all. A 500 means it did not.
	 */
	const routes = ['/api/public/v1/volunteer/schedule', '/api/public/v1/volunteer/ticket/find'];

	for (const path of routes) {
		test(`${path} does not fail to evaluate on the server`, async ({ request }) => {
			const response = await request.post(path, { data: { phone: PHONE } });

			expect(response.status(), await response.text()).not.toBe(500);
			// Whatever it answers must be the route's own JSON, not a crash page.
			expect(await response.json()).toHaveProperty('success');
		});
	}

	test('rejects a malformed phone before reaching upstream', async ({ request }) => {
		const response = await request.post('/api/public/v1/volunteer/schedule', {
			data: { phone: 'nope' }
		});

		expect(response.status()).toBe(422);
		expect(await response.json()).toMatchObject({ error: 'INVALID_INPUT' });
	});
});

test.describe('Answering an offered shift (CR-092 FR-VOL-06)', () => {
	const CODE = 'SEED-99';

	test('sends the code the manager read out along with the signed-in phone', async ({ page }) => {
		let sent: Record<string, unknown> | null = null;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule/respond', async (route) => {
			sent = route.request().postDataJSON();
			await route.fulfill(
				json({ success: true, assignment_id: sent?.assignment_id, dispatch_status: 'accepted' })
			);
		});
		await openPortalTab(page);
		await signIn(page, PHONE);

		await page.getByLabel('รหัสยืนยันภารกิจ').fill(CODE);
		await page.getByRole('button', { name: /ยอมรับภารกิจ/ }).click();

		await expect.poll(() => sent).not.toBeNull();
		expect(sent).toMatchObject({
			assignment_id: 'shift_assignment:01UPCOMING',
			// Both factors travel together — neither is enough on its own.
			phone: PHONE,
			// Normalised client-side, so the server compares one canonical form.
			code: 'SEED99',
			action: 'accepted'
		});
	});

	test('declining sends the other action', async ({ page }) => {
		let sent: Record<string, unknown> | null = null;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule/respond', async (route) => {
			sent = route.request().postDataJSON();
			await route.fulfill(json({ success: true, assignment_id: 'x', dispatch_status: 'declined' }));
		});
		await openPortalTab(page);
		await signIn(page, PHONE);

		await page.getByLabel('รหัสยืนยันภารกิจ').fill(CODE);
		await page.getByRole('button', { name: /ปฏิเสธภารกิจ/ }).click();

		await expect.poll(() => sent).not.toBeNull();
		expect(sent).toMatchObject({ action: 'declined' });
	});

	test('refuses to send a code with a character the alphabet excludes', async ({ page }) => {
		let called = false;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule/respond', async (route) => {
			called = true;
			await route.fulfill(json({ success: true, assignment_id: 'x', dispatch_status: 'accepted' }));
		});
		await openPortalTab(page);
		await signIn(page, PHONE);

		// `O` is not in the spoken alphabet — it is what someone hears instead of a zero.
		await page.getByLabel('รหัสยืนยันภารกิจ').fill('SEED-O9');
		await page.getByRole('button', { name: /ยอมรับภารกิจ/ }).click();

		await expect(page.getByText('รหัสไม่ถูกต้อง')).toBeVisible();
		expect(called, 'a malformed code must not reach the server').toBe(false);
	});

	test('shows what the server said when the answer is refused', async ({ page }) => {
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule/respond', (route) =>
			route.fulfill(json({ success: false, error: 'OFFER_NOT_FOUND' }, 404))
		);
		await openPortalTab(page);
		await signIn(page, PHONE);

		await page.getByLabel('รหัสยืนยันภารกิจ').fill(CODE);
		await page.getByRole('button', { name: /ยอมรับภารกิจ/ }).click();

		// Scoped to the card's own message — the same copy also goes out as a toast.
		await expect(page.getByRole('alert')).toContainText('ไม่พบภารกิจนี้ หรือรหัสไม่ถูกต้อง');
	});

	test('only the offered shift asks for a code', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);

		// Three shifts on screen; only the `dispatched` one is awaiting an answer.
		await expect(page.getByLabel('รหัสยืนยันภารกิจ')).toHaveCount(1);
		await expect(page.getByText(/ศูนย์เสนอมอบหมายภารกิจนี้ให้คุณ/)).toHaveCount(1);
	});
});
