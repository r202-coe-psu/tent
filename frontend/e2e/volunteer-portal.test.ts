import { test, expect, type Page } from '@playwright/test';

/**
 * Volunteer Access Portal + ตารางทำงานจิตอาสา (CR-092 หน้าจอ 2 + 6).
 *
 * A volunteer has no account: they sign in with the phone number they applied with, or
 * with their tracking token. These tests cover that entry point, the schedule it opens,
 * and the Digital Pass it can open (docs/changes/draft-volunteer-role-card-checkin.md —
 * the old `VIEW-` read-only phone-lookup reference has been removed entirely; on-site
 * check-in resolves the volunteer's own permanent tracking token directly).
 */

const PHONE = '0891112222';
const TRACKING_TOKEN = 'TKT-VOL-1234567890ABCDEF1234567890ABCDEF';

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
			job_id: 'job:01JOB',
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
	// The portal counts open jobs for its second tab, and the board it mounts there reads
	// the same endpoint. Empty is fine — no test here asserts on the board itself.
	await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
		route.fulfill(json({ success: true, jobs: [] }))
	);
	await page.route('**/api/public/v1/volunteer/profile', (route) =>
		route.fulfill(json({ success: true, profile: PROFILE }))
	);
	await page.route('**/api/public/v1/volunteer/access/resolve', (route) =>
		route.fulfill(json({ success: true, profile: PROFILE }))
	);
	// The profile form offers whatever Master Data holds, so the fixture stands in for it.
	await page.route('**/api/public/v1/config/volunteer-skills*', (route) =>
		route.fulfill(json({ volunteerSkills: SKILLS }))
	);
}

const SKILLS = [
	{
		code: 'cooking',
		label_th: 'ประกอบอาหาร / ครัวสนาม',
		label_en: 'Kitchen / field kitchen',
		category: 'operational',
		description: '',
		is_default: true
	},
	{
		code: 'driver',
		label_th: 'ขับขี่ยานพาหนะ / ขนส่ง',
		label_en: 'Driving / transport',
		category: 'operational',
		description: '',
		is_default: false
	},
	{
		code: 'medical',
		label_th: 'การแพทย์ / ปฐมพยาบาล',
		label_en: 'Medical / first aid',
		category: 'controlled',
		description: '',
		is_default: false
	}
];

const PROFILE = {
	portal_id: '01PORTALVOLUNTEER',
	first_name: 'สมชาย',
	last_name: 'ใจดี',
	nickname: null,
	phone_masked: 'xxx-xxx-2222',
	email: null,
	volunteer_code: 'V-001',
	skills: ['ประกอบอาหาร / ครัวสนาม'],
	organization: null,
	identity_verified: true,
	personnel_type: 'volunteer',
	shelter_codes: ['SH001']
};

/** Open the portal tab — it is the second tab, not the landing one. */
async function openPortalTab(page: Page) {
	await page.goto('/volunteers/portal');
	await expect(page.locator('#volunteer-phone-input')).toBeVisible();
}

/** Sign in with a phone number. The resolve endpoint decides whether it exists. */
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

/** The signed-in marker — the icon-only sign-out control, found by its aria-label. */
function signOutButton(page: Page) {
	return page.getByRole('button', { name: 'ออกจากระบบ / ลืมเครื่องนี้' });
}

test.describe('Volunteer Access Portal (CR-092 หน้าจอ 6)', () => {
	test('a live phone number shows the roster the server holds', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);

		await expect(signOutButton(page)).toBeVisible();
		// Rendered twice by design: once as the booking, once as the shift rostered from it.
		await expect(page.getByText('ผู้ช่วยครัวจัดเตรียมอาหาร').first()).toBeVisible();
		await expect(page.getByText('จุดปฏิบัติงาน: ครัวกลาง')).toBeVisible();
		await expect(page.getByText('เจ้าหน้าที่ช่วยลงทะเบียนผู้ประสบภัย')).toBeVisible();
	});

	for (const [label, size] of [
		['phone', { width: 390, height: 844 }],
		['desktop', { width: 1280, height: 900 }]
	] as const) {
		test(`the QR role card sits above the shift list on ${label} (#1064)`, async ({ page }) => {
			await page.setViewportSize(size);
			await mockPortalApi(page);
			await openPortalTab(page);
			await signIn(page, PHONE);

			const card = page.getByRole('heading', { name: 'บัตรอาสาสมัครอัจฉริยะ (QR Role Card)' });
			const list = page.getByRole('heading', { name: 'รายการงานอาสาสมัครของฉัน' });
			await expect(card).toBeVisible();
			await expect(list).toBeVisible();
			const [cardBox, listBox] = [await card.boundingBox(), await list.boundingBox()];
			expect(cardBox!.y).toBeLessThan(listBox!.y);
		});
	}

	test('every number goes to the server — there is no built-in fixture session', async ({
		page
	}) => {
		// A number the server does not know must stay on the login screen, never open a
		// made-up dashboard.
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/access/resolve', (route) =>
			route.fulfill(json({ success: true, profile: null }))
		);
		await page.route('**/api/public/v1/volunteer/schedule', (route) =>
			route.fulfill(json({ success: true, shifts: [] }))
		);
		await page.route('**/api/public/v1/volunteer/ticket/find', (route) =>
			route.fulfill(json({ success: true, tickets: [] }))
		);
		await openPortalTab(page);
		await signIn(page, '081-9992211');

		await expect(page.getByText('ไม่พบเบอร์โทรศัพท์นี้ในระบบอาสาสมัคร').first()).toBeVisible();
		await expect(signOutButton(page)).toHaveCount(0);
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

	test('a ticket code signs in and opens the same roster a phone does', async ({ page }) => {
		// The QR on a pass is a sign-in route (CR-092 หน้าจอ 6) — it must not navigate away
		// to the pass the volunteer already has in their hand.
		let asked: unknown = null;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/schedule', async (route) => {
			asked = route.request().postDataJSON();
			await route.fulfill(json(SCHEDULE));
		});
		await openPortalTab(page);
		await signInWithToken(page, TRACKING_TOKEN);

		await expect(signOutButton(page)).toBeVisible();
		await expect(page.getByText('ผู้ช่วยครัวจัดเตรียมอาหาร').first()).toBeVisible();
		await expect(page).toHaveURL(/\/volunteers\/portal\/volunteer\/01PORTALVOLUNTEER\/dashboard/);
		// The token goes to the server as the credential; the phone is never invented here.
		expect(asked).toEqual({ token: TRACKING_TOKEN, portal_id: '01PORTALVOLUNTEER' });
	});

	test('refuses a code that is not a tracking token', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signInWithToken(page, 'V-1001');

		await expect(page.getByText(/ต้องขึ้นต้นด้วย TKT-VOL-/)).toBeVisible();
		await expect(signOutButton(page)).toHaveCount(0);
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

test.describe('Booking a mission from the board (CR-092 FR-VOL-02)', () => {
	/** One open job with an implicit today shift (from the empty `shift_template.days`). */
	async function mockJobBoard(
		page: Page,
		applyResponse: Record<string, unknown>,
		skillsRequired: string[] = []
	) {
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						{
							job_id: 'job:01BOARD',
							shelter_code: 'SH001',
							shelter_name: 'ศูนย์ทดสอบ',
							title: 'ผู้ช่วยครัวจัดเตรียมอาหาร',
							description: 'ช่วยเตรียมอาหารกลางวัน',
							tier: 'operational',
							skills_required: skillsRequired,
							shift_template: {
								shift_name: 'เช้า',
								start_time: '08:00',
								end_time: '12:00',
								days: []
							},
							quota: 10,
							slots_confirmed: 2,
							slots_remaining: 8,
							status: 'open',
							requires_review: false
						}
					]
				})
			)
		);
		// The preflight check the modal runs before it books — a fresh phone number, so
		// the flow goes straight through instead of stopping at the update-profile prompt.
		await page.route('**/api/public/v1/volunteer/apply/preflight', (route) =>
			route.fulfill(
				json({
					success: true,
					match: 'no_match',
					message: 'ไม่พบ Volunteer profile เดิม สามารถสมัครใหม่ได้'
				})
			)
		);
		await page.route('**/api/public/v1/volunteer/jobs/*/apply', (route) =>
			route.fulfill(json(applyResponse))
		);
	}

	/** Fill and submit the Job Board's own quick-apply form (not the portal's). */
	async function bookAMission(page: Page) {
		await page.goto('/volunteers/jobs');
		await page.getByRole('button', { name: 'สมัครกะนี้' }).click();

		// Scoped to the modal's own form — the board's skill filter chips behind it share
		// the same label text, and stay mounted (just covered) while the modal is open.
		const form = page.locator('form');
		await form.locator('#firstName').fill('เก่งกล้า');
		await form.locator('#lastName').fill('งานอาสา');
		await form.locator('#phone').fill('0891112222');
		// At least one skill is required before the form will submit.
		await form.getByRole('button', { name: 'ประกอบอาหาร / ครัวสนาม' }).click();
		await form.getByRole('checkbox').check();
		await form.getByRole('button', { name: /ยืนยันการสมัคร/ }).click();
	}

	test('a first-ever booking lands the volunteer straight on their Digital Pass', async ({
		page
	}) => {
		// First-ever application for this phone number: apply mints a permanent
		// per-volunteer token and returns it as `volunteer_token`, so the board routes
		// straight to the pass with it — no portal sign-in round trip needed.
		const freshToken = 'TKT-VOL-FRESHVOLUNTEERTOKEN00000000001';
		await mockPortalApi(page);
		await page.route(`**/api/public/v1/volunteer/ticket/${freshToken}`, (route) =>
			route.fulfill(json(ticket({ token: freshToken })))
		);
		await mockJobBoard(page, {
			success: true,
			tracking_token: TRACKING_TOKEN,
			volunteer_token: freshToken,
			status: 'confirmed',
			job_id: 'job:01BOARD'
		});

		await bookAMission(page);

		await expect(page).toHaveURL(new RegExp(`/volunteer/ticket/${freshToken}`));
		await expect(page.getByRole('img', { name: 'QR Code สำหรับรายงานตัวหน้างาน' })).toBeVisible();
	});

	test('a returning volunteer (no fresh token) is signed into the portal by phone instead', async ({
		page
	}) => {
		// Returning volunteer: the apply response carries no `volunteer_token` (only its
		// hash is stored server-side, so the plaintext can't be handed back) — the board
		// falls back to signing them into the portal with the phone they just typed.
		let resolveAskedWith: unknown = null;
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/access/resolve', async (route) => {
			resolveAskedWith = route.request().postDataJSON();
			await route.fulfill(json({ success: true, profile: PROFILE }));
		});
		await mockJobBoard(page, {
			success: true,
			tracking_token: TRACKING_TOKEN,
			status: 'confirmed',
			job_id: 'job:01BOARD'
		});

		await bookAMission(page);

		await expect(page).toHaveURL(/\/volunteers\/portal\/volunteer\/01PORTALVOLUNTEER\/dashboard/);
		expect(resolveAskedWith).toEqual({ phone: '0891112222' });
	});

	test('opens the form and shows the skills by name from Master Data', async ({ page }) => {
		// The skills endpoint sends label_th / label_en only. Matching a job's required
		// skills against it used to read a `label` that is not there and crash the page.
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true }, ['driver', 'cooking']);

		await page.goto('/volunteers/jobs');
		await page.getByRole('button', { name: 'สมัครกะนี้' }).click();

		const form = page.locator('form');
		await expect(form.getByRole('button', { name: 'ประกอบอาหาร / ครัวสนาม' })).toBeVisible();
		await expect(form.getByRole('button', { name: 'ขับขี่ยานพาหนะ / ขนส่ง' })).toBeVisible();
		expect(pageErrors).toEqual([]);
	});

	test('the shift picker lists each date with its own times, and books the ones picked', async ({
		page
	}) => {
		const day = (offset: number) =>
			new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
		const shift = (id: string, date: string, start: string, end: string, confirmed: number) => ({
			shift_id: id,
			date,
			start_time: start,
			end_time: end,
			quota: 5,
			slots_confirmed: confirmed
		});
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		// Registered after mockJobBoard, so these answers win.
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						{
							job_id: 'job:01PICKER',
							shelter_code: 'SH001',
							shelter_name: 'ศูนย์ทดสอบ',
							title: 'งานหลายกะ',
							description: 'ทดสอบตัวเลือกกะ',
							tier: 'operational',
							skills_required: [],
							shifts: [
								shift('d1-am', day(1), '08:00', '12:00', 1),
								shift('d2-am', day(2), '08:00', '12:00', 5),
								shift('d2-pm', day(2), '13:00', '17:00', 5),
								shift('d3-am', day(3), '08:00', '12:00', 5),
								shift('d3-pm', day(3), '13:00', '17:00', 2)
							],
							quota: 25,
							slots_confirmed: 18,
							slots_remaining: 7,
							status: 'open',
							requires_review: false
						}
					]
				})
			)
		);
		let applied: Record<string, unknown> | null = null;
		await page.route('**/api/public/v1/volunteer/jobs/*/apply', async (route) => {
			applied = route.request().postDataJSON();
			await route.fulfill(json({ success: true }));
		});

		await page.goto('/volunteers/jobs');
		await page.getByRole('button', { name: 'สมัครกะนี้' }).first().click();

		const form = page.locator('form');
		const row = (offset: number) => form.locator(`[data-shift-date="${day(offset)}"]`);
		// One row per date, each with its own times — no date hidden off-screen.
		await expect(form.locator('[data-shift-date]')).toHaveCount(3);
		// Day 2 is full on every shift: both times are shown, neither can be picked.
		await expect(row(2).getByRole('button')).toHaveCount(2);
		for (const time of await row(2).getByRole('button').all()) await expect(time).toBeDisabled();
		// Day 3: the full morning cannot be picked; the afternoon can.
		await expect(row(3).getByRole('button', { name: /08:00–12:00/ })).toBeDisabled();
		// The card's own shift (day 1) starts picked; more can be added, and a tap removes one.
		const day1 = row(1).getByRole('button', { name: /08:00–12:00/ });
		const day3pm = row(3).getByRole('button', { name: /13:00–17:00/ });
		await expect(day1).toHaveAttribute('aria-pressed', 'true');
		await day3pm.click();
		await expect(day3pm).toHaveAttribute('aria-pressed', 'true');
		await expect(day1).toHaveAttribute('aria-pressed', 'true');
		await day1.click();
		await expect(day1).toHaveAttribute('aria-pressed', 'false');
		await day1.click();

		await form.locator('#firstName').fill('เก่งกล้า');
		await form.locator('#lastName').fill('งานอาสา');
		await form.locator('#phone').fill('0891112222');
		await form.getByRole('button', { name: 'ประกอบอาหาร / ครัวสนาม' }).click();
		await form.getByRole('checkbox').check();
		await form.getByRole('button', { name: /ยืนยันการสมัคร/ }).click();

		await expect.poll(() => applied).not.toBeNull();
		// Both picked shifts in one request, in date order (#716).
		expect(applied).toMatchObject({
			shifts: [
				{ shift_id: 'd1-am', shift_date: day(1), start_time: '08:00', end_time: '12:00' },
				{ shift_id: 'd3-pm', shift_date: day(3), start_time: '13:00', end_time: '17:00' }
			]
		});
	});

	test('says which shifts were not saved, and why, before leaving the form (#716)', async ({
		page
	}) => {
		const day = (offset: number) =>
			new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						{
							job_id: 'job:01PARTIAL',
							shelter_code: 'SH001',
							shelter_name: 'ศูนย์ทดสอบ',
							title: 'งานสองกะ',
							description: 'ทดสอบผลรายกะ',
							tier: 'operational',
							skills_required: [],
							shifts: [
								{
									shift_id: 'p-am',
									date: day(1),
									start_time: '08:00',
									end_time: '12:00',
									quota: 5,
									slots_confirmed: 0
								},
								{
									shift_id: 'p-pm',
									date: day(1),
									start_time: '13:00',
									end_time: '17:00',
									quota: 5,
									slots_confirmed: 0
								}
							],
							quota: 10,
							slots_confirmed: 0,
							slots_remaining: 10,
							status: 'open',
							requires_review: false
						}
					]
				})
			)
		);
		await page.route('**/api/public/v1/volunteer/jobs/*/apply', (route) =>
			route.fulfill(
				json(
					{
						success: true,
						tracking_token: 'TKT-AM',
						status: 'confirmed',
						job_id: 'job:01PARTIAL',
						shift_id: 'p-am',
						results: [
							{ ok: true, shift_id: 'p-am', status: 'confirmed', tracking_token: 'TKT-AM' },
							{ ok: false, shift_id: 'p-pm', error: 'SHIFT_FULL' }
						]
					},
					201
				)
			)
		);

		await page.goto('/volunteers/jobs');
		await page.getByRole('button', { name: 'สมัครกะนี้' }).first().click();
		const form = page.locator('form');
		await form
			.locator(`[data-shift-date="${day(1)}"]`)
			.getByRole('button', { name: /13:00–17:00/ })
			.click();
		await form.locator('#firstName').fill('เก่งกล้า');
		await form.locator('#lastName').fill('งานอาสา');
		await form.locator('#phone').fill('0891113333');
		await form.getByRole('checkbox').check();
		await form.getByRole('button', { name: /ยืนยันการสมัคร/ }).click();

		const outcome = page.getByRole('alertdialog');
		await expect(outcome.getByRole('heading', { name: 'บางกะสมัครไม่สำเร็จ' })).toBeVisible();
		await expect(outcome).toContainText('บันทึกแล้ว 1 กะ');
		await expect(outcome).toContainText('ไม่ผ่าน 1 กะ');
		await expect(outcome).toContainText('13:00–17:00');
		await expect(outcome).toContainText('กะนี้เต็มแล้ว');
		await outcome.getByRole('button', { name: 'ไปต่อ' }).click();
		await expect(page).toHaveURL(/\/volunteers\/portal/);
	});

	test('a long job shows its first week of dates and says how many more there are', async ({
		page
	}) => {
		const day = (offset: number) =>
			new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						{
							job_id: 'job:01LONG',
							shelter_code: 'SH001',
							shelter_name: 'ศูนย์ทดสอบ',
							title: 'งานยาวสิบวัน',
							description: 'ทดสอบรายการวัน',
							tier: 'operational',
							skills_required: [],
							shifts: Array.from({ length: 10 }, (_, i) => ({
								shift_id: `s${i}`,
								date: day(i + 1),
								start_time: '08:00',
								end_time: '12:00',
								quota: 5,
								slots_confirmed: 0
							})),
							quota: 50,
							slots_confirmed: 0,
							slots_remaining: 50,
							status: 'open',
							requires_review: false
						}
					]
				})
			)
		);

		await page.goto('/volunteers/jobs');
		await page.getByRole('button', { name: 'สมัครกะนี้' }).first().click();

		const form = page.locator('form');
		await expect(form.locator('[data-shift-date]')).toHaveCount(7);
		await form.getByRole('button', { name: 'แสดงวันที่เหลืออีก 3 วัน' }).click();
		await expect(form.locator('[data-shift-date]')).toHaveCount(10);
		await expect(form.getByRole('button', { name: /แสดงวันที่เหลืออีก/ })).toHaveCount(0);
	});

	test('a job card with many shifts shows a few, summarises the rest, and expands', async ({
		page
	}) => {
		const day = (offset: number) =>
			new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						{
							job_id: 'job:01MANYSHIFTS',
							shelter_code: 'SH001',
							shelter_name: 'ศูนย์ทดสอบ',
							title: 'งานสองสัปดาห์',
							description: 'ทดสอบการพับรายการกะ',
							tier: 'operational',
							skills_required: [],
							// 7 days × morning/afternoon; day 5 is full on both.
							shifts: Array.from({ length: 7 }, (_, d) =>
								['08:00', '13:00'].map((start, i) => ({
									shift_id: `s${d}${i}`,
									date: day(d + 1),
									start_time: start,
									end_time: i === 0 ? '12:00' : '17:00',
									quota: 5,
									slots_confirmed: d === 4 ? 5 : 1
								}))
							).flat(),
							quota: 70,
							slots_confirmed: 20,
							slots_remaining: 50,
							status: 'open',
							requires_review: false
						}
					]
				})
			)
		);
		const applyButtons = page.getByRole('button', { name: 'สมัครกะนี้' });
		const toggle = page.getByRole('button', { name: /ดูกะทั้งหมด \(14 กะ\)/ });

		// Phone: three shifts in full, the other eleven summarised by date and time.
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/volunteers/jobs');
		await expect(applyButtons).toHaveCount(3);
		await expect(page.getByText('ยังมีอีก 11 กะ ใน 6 วัน')).toBeVisible();
		await expect(page.getByText('08:00–12:00').first()).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'false');

		await toggle.click();
		await expect(applyButtons).toHaveCount(12); // day 5's two full shifts cannot be applied for
		await expect(page.getByText(/ยังมีอีก \d+ กะ/)).toHaveCount(0);
		await page.getByRole('button', { name: 'ย่อรายการกะ' }).click();
		await expect(applyButtons).toHaveCount(3);

		// Wider screens show two full rows (4 shifts) before summarising.
		await page.setViewportSize({ width: 1280, height: 900 });
		await expect(applyButtons).toHaveCount(4);
		await expect(page.getByText('ยังมีอีก 10 กะ ใน 5 วัน')).toBeVisible();
	});

	test('scrolling inside the apply modal never moves the page behind it', async ({ page }) => {
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		await page.setViewportSize({ width: 375, height: 667 });
		await page.goto('/volunteers/jobs');
		const apply = page.getByRole('button', { name: 'สมัครกะนี้' }).first();
		await expect(apply).toBeVisible();
		await page.mouse.move(187, 400);
		await page.mouse.wheel(0, 300);
		await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);

		await apply.click();
		await expect(page.locator('#firstName')).toBeVisible();
		// Measured once the modal is open — clicking scrolls the button into view first.
		const before = await page.evaluate(() => window.scrollY);
		expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('hidden');
		// Past the end of the modal's own scroll, then over the backdrop.
		await page.mouse.move(187, 400);
		for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 800);
		await page.mouse.move(187, 8);
		await page.mouse.wheel(0, 800);
		expect(await page.evaluate(() => window.scrollY)).toBe(before);

		await page.getByRole('button', { name: 'Close modal' }).click({ position: { x: 8, y: 8 } });
		await expect(page.locator('#firstName')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.style.overflow)).toBe('');
	});

	test('opens filtered to the shelter a home-page card links to (#709)', async ({ page }) => {
		const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
		const boardJob = (code: string, name: string, title: string) => ({
			job_id: `job:01${code}`,
			shelter_code: code,
			shelter_name: name,
			title,
			description: 'ทดสอบตัวกรองศูนย์',
			tier: 'operational',
			skills_required: [],
			shifts: [
				{
					shift_id: `${code}-am`,
					date: day,
					start_time: '08:00',
					end_time: '12:00',
					quota: 5,
					slots_confirmed: 0
				}
			],
			quota: 5,
			slots_confirmed: 0,
			slots_remaining: 5,
			status: 'open',
			requires_review: false
		});
		await mockPortalApi(page);
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: [
						boardJob('SH001', 'ศูนย์ทดสอบหนึ่ง', 'งานของศูนย์หนึ่ง'),
						boardJob('SH002', 'ศูนย์ทดสอบสอง', 'งานของศูนย์สอง')
					]
				})
			)
		);

		await page.goto('/volunteers/jobs?shelter=SH002');

		await expect(page.getByRole('heading', { name: 'งานของศูนย์สอง' })).toBeVisible();
		await expect(page.getByRole('heading', { name: 'งานของศูนย์หนึ่ง' })).toHaveCount(0);
	});

	test('picking another page takes the reader to its first job', async ({ page }) => {
		const day = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
		await mockPortalApi(page);
		await mockJobBoard(page, { success: true });
		// Eight jobs: page 1 holds six, page 2 the last two.
		await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
			route.fulfill(
				json({
					success: true,
					jobs: Array.from({ length: 8 }, (_, i) => ({
						job_id: `job:01PAGE${i}`,
						shelter_code: 'SH001',
						shelter_name: 'ศูนย์ทดสอบ',
						title: `งานหน้า ${i + 1}`,
						description: 'ทดสอบการเปลี่ยนหน้า',
						tier: 'operational',
						skills_required: [],
						shifts: [
							{
								shift_id: `s${i}`,
								date: day,
								start_time: '08:00',
								end_time: '12:00',
								quota: 5,
								slots_confirmed: 0
							}
						],
						quota: 5,
						slots_confirmed: 0,
						slots_remaining: 5,
						status: 'open',
						requires_review: false
					}))
				})
			)
		);
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto('/volunteers/jobs');
		const pageTwo = page.locator('[data-slot="pagination-link"]', { hasText: '2' });
		await pageTwo.scrollIntoViewIfNeeded();

		await pageTwo.click();

		const firstOfPageTwo = page.getByRole('heading', { name: 'งานหน้า 7' });
		await expect(firstOfPageTwo).toBeInViewport();
		// Not hidden under the fixed navbar.
		const navbar = await page.locator('header').first().boundingBox();
		expect((await firstOfPageTwo.boundingBox())!.y).toBeGreaterThanOrEqual(
			navbar!.y + navbar!.height
		);
		// Keyboard and screen-reader users land on the new page's jobs too.
		await expect(
			page.locator('[tabindex="-1"][aria-label="งานอาสาสมัครในศูนย์พักพิง"]')
		).toBeFocused();
	});
});

test.describe('Editing your own profile', () => {
	async function openProfile(page: Page) {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);
		await page.getByRole('button', { name: 'แก้ไขโปรไฟล์' }).click();
		// Scoped, because the dashboard behind the dialog shows the same badge and the
		// same skill names — an unscoped locator matches both.
		return page.getByRole('dialog');
	}

	test('shows what staff own as read-only and offers only the skills', async ({ page }) => {
		const dialog = await openProfile(page);

		await expect(dialog.getByText('V-001 · xxx-xxx-2222')).toBeVisible();
		await expect(dialog.getByText('ยืนยันตัวตนแล้ว')).toBeVisible();
		// The number this portal signs in by is never an input here.
		await expect(dialog.getByRole('textbox')).toHaveCount(0);
		// The skill already on the profile comes back selected, not blank.
		await expect(dialog.getByRole('button', { name: /ประกอบอาหาร/, pressed: true })).toBeVisible();
	});

	test('sends only the skills, and only what changed', async ({ page }) => {
		let sent: unknown = null;
		const dialog = await openProfile(page);
		await page.route('**/api/public/v1/volunteer/profile/update', async (route) => {
			sent = route.request().postDataJSON();
			await route.fulfill(
				json({
					success: true,
					updated: 1,
					profile: { ...PROFILE, skills: ['ขับขี่ยานพาหนะ / ขนส่ง'] }
				})
			);
		});

		// Untouched, the save button has nothing to do.
		await expect(dialog.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' })).toBeDisabled();

		await dialog.getByRole('button', { name: /ประกอบอาหาร/ }).click();
		await dialog.getByRole('button', { name: /ขับขี่ยานพาหนะ/ }).click();
		await dialog.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();

		await expect(dialog).toHaveCount(0);
		expect(sent).toEqual({
			phone: PHONE,
			portal_id: '01PORTALVOLUNTEER',
			skills: ['ขับขี่ยานพาหนะ / ขนส่ง']
		});
	});

	test('says what went wrong instead of closing on a refusal', async ({ page }) => {
		const dialog = await openProfile(page);
		await page.route('**/api/public/v1/volunteer/profile/update', (route) =>
			route.fulfill(json({ success: false, error: 'PROFILE_NOT_FOUND' }, 404))
		);

		await dialog.getByRole('button', { name: /ขับขี่ยานพาหนะ/ }).click();
		await dialog.getByRole('button', { name: 'บันทึกการเปลี่ยนแปลง' }).click();

		// Still open, with the reason on screen — a closed dialog would read as success.
		await expect(dialog.getByRole('alert')).toContainText('ไม่พบโปรไฟล์');
		await expect(dialog).toBeVisible();
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

		// The strict lookup budget is charged before validation (CR-127 R-9), and the
		// requests above share this IP's budget: a malformed phone is turned away either as
		// INVALID_INPUT or, once the budget is spent, RATE_LIMITED. Reaching upstream would
		// be a 503 (FastAPI is not running here) — that must never happen.
		const body = await response.json();
		expect([422, 429], JSON.stringify(body)).toContain(response.status());
		expect(['INVALID_INPUT', 'RATE_LIMITED']).toContain(body.error);
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

		await page.getByLabel('รหัสยืนยันงานอาสาสมัคร').fill(CODE);
		await page.getByRole('button', { name: /ยอมรับงานอาสาสมัคร/ }).click();

		await expect.poll(() => sent).not.toBeNull();
		expect(sent).toMatchObject({
			assignment_id: 'shift_assignment:01UPCOMING',
			// Both factors travel together — neither is enough on its own.
			phone: PHONE,
			portal_id: '01PORTALVOLUNTEER',
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

		await page.getByLabel('รหัสยืนยันงานอาสาสมัคร').fill(CODE);
		await page.getByRole('button', { name: /ปฏิเสธงานอาสาสมัคร/ }).click();

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
		await page.getByLabel('รหัสยืนยันงานอาสาสมัคร').fill('SEED-O9');
		await page.getByRole('button', { name: /ยอมรับงานอาสาสมัคร/ }).click();

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

		await page.getByLabel('รหัสยืนยันงานอาสาสมัคร').fill(CODE);
		await page.getByRole('button', { name: /ยอมรับงานอาสาสมัคร/ }).click();

		// Scoped to the card's own message — the same copy also goes out as a toast.
		await expect(page.getByRole('alert')).toContainText('ไม่พบงานอาสาสมัครนี้ หรือรหัสไม่ถูกต้อง');
	});

	test('only the offered shift asks for a code', async ({ page }) => {
		await mockPortalApi(page);
		await openPortalTab(page);
		await signIn(page, PHONE);

		// Three shifts on screen; only the `dispatched` one is awaiting an answer.
		await expect(page.getByLabel('รหัสยืนยันงานอาสาสมัคร')).toHaveCount(1);
		await expect(page.getByText(/ศูนย์เสนอมอบหมายงานอาสาสมัครนี้ให้คุณ/)).toHaveCount(1);
	});
});
