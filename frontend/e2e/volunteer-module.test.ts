import { test, expect, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	SA_ROLES,
	SM_SH001_ROLES,
	STAFF_SH001_ROLES
} from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

/**
 * Volunteer module E2E coverage.
 *
 * The public surface is covered with the real page and mocked public BFF
 * responses. The back-office surface uses an in-memory CouchDB boundary so
 * the tests exercise the SvelteKit pages and repository guards without
 * persisting volunteer/job fixtures into a shared shelter database.
 */

const BASE = 'http://localhost:4173';
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const TODAY = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Bangkok',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
}).format(new Date());

const ACCOUNTS = {
	sa: {
		name: `volunteer_e2e_sa_${RUN_ID}`,
		password: 'Password1!',
		roles: SA_ROLES,
		display_name: 'Volunteer E2E SA'
	},
	sm: {
		name: `volunteer_e2e_sm_${RUN_ID}`,
		password: 'Password1!',
		roles: SM_SH001_ROLES,
		display_name: 'Volunteer E2E SM'
	},
	staff: {
		name: `volunteer_e2e_staff_${RUN_ID}`,
		password: 'Password1!',
		roles: STAFF_SH001_ROLES,
		display_name: 'Volunteer E2E Staff'
	}
} as const;

const sessions: Record<keyof typeof ACCOUNTS, string> = {
	sa: '',
	sm: '',
	staff: ''
};

const SHELTER_DOC = {
	_id: 'shelter:SH001',
	type: 'shelter',
	schema_v: 5,
	code: 'SH001',
	name: 'ศูนย์พักพิง E2E',
	site_kind: 'evacuation_center',
	operation_status: 'active',
	capacity: 100,
	zones: [],
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z'
};

const JOB_DOC = {
	_id: 'job:01JVOLUNTEERE2EJOB',
	_rev: '1-test',
	type: 'job' as const,
	schema_v: 3 as const,
	shelter_code: 'SH001',
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z',
	created_by: 'volunteer-e2e',
	title: 'งานอาสา E2E ครัวกลาง',
	description: 'ช่วยเตรียมอาหารสำหรับผู้พักพิง',
	tier: 'operational' as const,
	required_roles: [],
	skills_required: ['cooking'],
	quota: 2,
	slots_confirmed: 0,
	slots_dispatched: 0,
	slots_remaining: 2,
	shifts: [
		{
			id: 'morning-1',
			date: TODAY,
			end_date: TODAY,
			start_time: '08:00',
			end_time: '12:00',
			quota: 2
		}
	],
	auto_accept: false,
	status: 'open' as const,
	is_urgent: false
};

const VOLUNTEER_DOC = {
	_id: 'volunteer:01JVOLUNTEERE2EVOL',
	_rev: '1-test',
	type: 'volunteer' as const,
	schema_v: 4 as const,
	shelter_code: 'SH001',
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z',
	created_by: 'volunteer-e2e',
	first_name: 'อาสา',
	last_name: 'ทดสอบ E2E',
	phone: '0891112222',
	email: null,
	skills: ['cooking'],
	organization: null,
	status: 'active' as const,
	user_name: null,
	checked_in: false,
	current_shelter_code: null,
	volunteer_code: 'V-901',
	identity_verified: true,
	source: 'staff_entry' as const,
	personnel_type: 'volunteer' as const
};

const ASSIGNMENT_DOC = {
	_id: 'shift_assignment:01JVOLUNTEERE2EASSIGN',
	_rev: '1-test',
	type: 'shift_assignment' as const,
	schema_v: 5 as const,
	shelter_code: 'SH001',
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z',
	created_by: 'volunteer-e2e',
	job_id: JOB_DOC._id,
	shift_id: 'morning-1',
	volunteer_id: VOLUNTEER_DOC._id,
	date: TODAY,
	shift: 'custom' as const,
	station: 'ครัวกลาง',
	duty_window: {
		start_ts: `${TODAY}T01:00:00.000Z`,
		end_ts: `${TODAY}T05:00:00.000Z`
	},
	check_in_at: null,
	check_out_at: null,
	check_in_by: null,
	check_out_by: null,
	status: 'assigned' as const,
	dispatch_status: 'accepted' as const,
	check_in_method: 'qr' as const,
	check_in_reason: null,
	check_out_method: 'qr' as const,
	check_out_reason: null
};

const SKILL_ITEMS = [
	{
		code: 'cooking',
		label_th: 'ประกอบอาหาร / ครัวสนาม',
		label_en: 'ประกอบอาหาร / ครัวสนาม',
		category: 'operational',
		description: 'เตรียมและแจกจ่ายอาหาร',
		is_default: true,
		status: 'active'
	},
	{
		code: 'first_aid',
		label_th: 'ปฐมพยาบาล',
		label_en: 'ปฐมพยาบาล',
		category: 'controlled',
		description: 'ดูแลปฐมพยาบาลเบื้องต้น',
		is_default: false,
		status: 'active'
	}
];

const PUBLIC_JOB = {
	job_id: JOB_DOC._id,
	shelter_code: 'SH001',
	shelter_name: SHELTER_DOC.name,
	title: JOB_DOC.title,
	description: JOB_DOC.description,
	tier: JOB_DOC.tier,
	skills_required: JOB_DOC.skills_required,
	shifts: [
		{
			id: 'morning-1',
			date: TODAY,
			start_time: '08:00',
			end_time: '12:00',
			quota: 2,
			slots_confirmed: 0,
			applicants_count: 0
		}
	],
	quota: JOB_DOC.quota,
	slots_confirmed: 0,
	slots_remaining: 2,
	status: 'open',
	requires_review: false
};

const json = (body: unknown, status = 200) => ({
	status,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

function couchDocs(
	options: {
		jobs?: readonly Record<string, unknown>[];
		volunteers?: readonly Record<string, unknown>[];
		assignments?: readonly Record<string, unknown>[];
	} = {}
) {
	return [
		...(options.jobs ?? [JOB_DOC]),
		...(options.volunteers ?? [VOLUNTEER_DOC]),
		...(options.assignments ?? [ASSIGNMENT_DOC])
	];
}

/** Mock only the CouchDB document boundary; auth session validation stays real. */
async function mockVolunteerCouch(
	page: Page,
	options: {
		jobs?: readonly Record<string, unknown>[];
		volunteers?: readonly Record<string, unknown>[];
		assignments?: readonly Record<string, unknown>[];
	} = {}
): Promise<{ writes: Record<string, unknown>[] }> {
	const docs = couchDocs(options);
	const writes: Record<string, unknown>[] = [];

	await page.route('**/*', async (route) => {
		const requestUrl = new URL(route.request().url());
		const segments = requestUrl.pathname.split('/').filter(Boolean);
		const dbName = segments[0];
		if (dbName !== 'registry' && !dbName?.startsWith('shelter_')) {
			await route.fallback();
			return;
		}

		if (segments[1] === '_changes') {
			await route.fulfill(json({ results: [], last_seq: '0', pending: 0 }));
			return;
		}

		if (segments[1] === '_all_docs') {
			const registryDocs = [SHELTER_DOC];
			const rows = (dbName === 'registry' ? registryDocs : docs).map((doc) => ({
				id: doc._id,
				doc
			}));
			await route.fulfill(json({ rows }));
			return;
		}

		if (segments[1] === '_find') {
			const body = (route.request().postDataJSON() ?? {}) as {
				selector?: { type?: string };
			};
			const found = docs.filter((doc) => !body.selector?.type || doc.type === body.selector.type);
			await route.fulfill(json({ docs: found }));
			return;
		}

		if (segments.length === 2 && route.request().method() === 'GET') {
			const id = decodeURIComponent(segments[1]);
			const found = (dbName === 'registry' ? [SHELTER_DOC] : docs).find((doc) => doc._id === id);
			if (!found) {
				await route.fulfill(json({ error: 'not_found', reason: 'missing' }, 404));
				return;
			}
			await route.fulfill(json(found));
			return;
		}

		if (route.request().method() === 'PUT' || route.request().method() === 'DELETE') {
			if (route.request().method() === 'PUT') {
				writes.push(route.request().postDataJSON() as Record<string, unknown>);
			}
			await route.fulfill(json({ ok: true, id: segments[1], rev: '2-e2e' }, 201));
			return;
		}

		await route.fallback();
	});

	await page.route('**/api/back-office/master-data/volunteer_skills*', (route) =>
		route.fulfill(
			json({
				_id: 'master_data:volunteer_skills:SH001',
				master_type: 'volunteer_skills',
				shelter_code: 'SH001',
				items: SKILL_ITEMS
			})
		)
	);
	await mockAuthStatus(page);

	return { writes };
}

async function mockAuthStatus(
	page: Page,
	account: (typeof ACCOUNTS)[keyof typeof ACCOUNTS] = ACCOUNTS.sm
): Promise<void> {
	await page.route('**/api/v1/auth/me', (route) =>
		route.fulfill(
			json({
				name: account.name,
				display_name: account.display_name,
				roles: account.roles,
				must_change_password: false,
				has_security_question: true,
				mfa_enrolled: false,
				pending_mfa: false
			})
		)
	);
}

async function mockPublicVolunteerJobs(page: Page): Promise<void> {
	await page.route('**/api/public/v1/volunteer/jobs*', (route) =>
		route.fulfill(json({ success: true, jobs: [PUBLIC_JOB], shelters: [SHELTER_DOC] }))
	);
	await page.route('**/api/public/v1/config/volunteer-skills*', (route) =>
		route.fulfill(json({ volunteerSkills: SKILL_ITEMS }))
	);
}

test.beforeAll(async () => {
	for (const account of Object.values(ACCOUNTS)) await createCouchUser(account);
	for (const [key, account] of Object.entries(ACCOUNTS) as [
		keyof typeof ACCOUNTS,
		(typeof ACCOUNTS)[keyof typeof ACCOUNTS]
	][]) {
		sessions[key] = await couchLogin(account.name, account.password);
	}
});

test.afterAll(async () => {
	for (const account of Object.values(ACCOUNTS)) await deleteCouchUser(account.name);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Volunteer public module', () => {
	test('renders an open mission and keeps private identity fields out of the public board', async ({
		page
	}) => {
		await mockPublicVolunteerJobs(page);
		await page.goto(`${BASE}/volunteers/jobs`);

		await expect(
			page.getByRole('heading', { name: 'งานอาสาสมัครในศูนย์พักพิง', level: 2 })
		).toBeVisible();
		await expect(page.getByText(JOB_DOC.title)).toBeVisible();
		await expect(page.getByRole('button', { name: /สมัครกะนี้/ })).toBeVisible();
		await expect(page.locator('body')).not.toContainText('1101700207030');
		await expect(page.locator('body')).not.toContainText(VOLUNTEER_DOC.phone);
	});
});

test.describe('Volunteer backoffice module', () => {
	test('shelter manager can move through Job Board, Roster, and People tabs', async ({ page }) => {
		await mockVolunteerCouch(page);
		await injectSession(page, ACCOUNTS.sm, sessions.sm);
		await page.goto(`${BASE}/back-office/volunteers`);

		await expect(page.getByText('Smart Volunteer Control Hub')).toBeVisible();
		await expect(page.getByRole('heading', { name: JOB_DOC.title })).toBeVisible();

		await page.getByRole('tab', { name: /ตารางกะและเช็คอิน/ }).click();
		await expect(page).toHaveURL(/\/back-office\/volunteers\?tab=roster$/);
		await expect(page.getByRole('heading', { name: /ตารางกะและเช็คอินจิตอาสา/ })).toBeVisible();
		await expect(page.getByLabel('ตารางกะและเช็คอิน').getByText('อาสา ทดสอบ E2E')).toBeVisible();

		await page.getByRole('tab', { name: /รายชื่อและการอนุมัติ/ }).click();
		await expect(page).toHaveURL(/\/back-office\/volunteers\?tab=people$/);
		await expect(
			page.getByLabel('รายชื่อและการอนุมัติ').getByText('ข้อมูลบุคคล (VOLUNTEER INFO)')
		).toBeVisible();
		await expect(page.getByLabel('รายชื่อและการอนุมัติ').getByText('อาสา ทดสอบ E2E')).toBeVisible();
	});

	test('opens a seeded job detail from the Job Board', async ({ page }) => {
		await mockVolunteerCouch(page);
		await injectSession(page, ACCOUNTS.sm, sessions.sm);
		await page.goto(`${BASE}/back-office/volunteers`);

		await page.getByRole('link', { name: /ดูรายละเอียด/ }).click();
		await expect(page).toHaveURL(/\/back-office\/volunteers\/jobs\/job%3A01JVOLUNTEERE2EJOB$/);
		await expect(page.getByRole('heading', { name: JOB_DOC.title })).toBeVisible();
		await expect(page.getByRole('tab', { name: /กะและตารางกะ/ })).toBeVisible();
		await expect(page.getByRole('tab', { name: /ผู้สมัคร/ })).toContainText('0');
	});

	test('registration staff cannot enter manager volunteer backoffice routes', async ({ page }) => {
		await mockAuthStatus(page, ACCOUNTS.staff);
		await injectSession(page, ACCOUNTS.staff, sessions.staff);
		await page.goto(`${BASE}/back-office/volunteers`);
		await expect(page).toHaveURL(/\/portal$/);

		await page.goto(`${BASE}/back-office/volunteers/jobs/${encodeURIComponent(JOB_DOC._id)}`);
		await expect(page).toHaveURL(/\/portal$/);
	});

	test('opens Volunteer Skills and the add-skill dialog without writing', async ({ page }) => {
		const { writes } = await mockVolunteerCouch(page);
		await injectSession(page, ACCOUNTS.sm, sessions.sm);
		await page.goto(`${BASE}/back-office/master-data?type=volunteer_skills`);

		await expect(page.getByRole('heading', { name: 'ทักษะมาตรฐานจิตอาสา' })).toBeVisible();
		await page.getByRole('button', { name: 'เพิ่มรายการ' }).first().click();
		await expect(page.getByRole('dialog')).toBeVisible();
		await expect(page.getByRole('dialog').getByText(/เพิ่มรายการ/)).toBeVisible();
		await expect.poll(() => writes).toHaveLength(0);
	});
});
