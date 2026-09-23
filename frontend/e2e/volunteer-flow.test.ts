import { test, expect, type Page, type Route } from '@playwright/test';
import { createCouchUser, deleteCouchUser, couchLogin, SM_SH001_ROLES } from './helpers/couch';
import { injectSession, clearSession } from './helpers/login';

/**
 * Full volunteer lifecycle E2E — one continuous flow rather than independent
 * scenarios, since each step's state feeds the next:
 *
 *   1. Admin (shelter manager) creates a job with a shift.
 *   2. A member of the public applies to that shift from the public job board.
 *   3. The same admin verifies the volunteer's identity on the People tab
 *      (a volunteer-level audit, separate from any one job's decision).
 *   4. The admin reviews and approves the job application.
 *   5. The admin — the job's creator — manually assigns the approved
 *      volunteer to the shift from the "Assign Volunteers" screen.
 *   6. The volunteer signs into the Access Portal and applies to a second,
 *      already-open job.
 *   7. On-site staff check the volunteer in, then out, by scanning/typing
 *      their permanent role-card token — blocked until step 3 verified them.
 *
 * Back-office and on-site screens write straight to CouchDB (mocked by
 * `mockCouch`, a stateful fake keyed on `_id`/`type` — unlike
 * `volunteer-module.test.ts`'s per-test static fixture, this flow needs a
 * write in one step to be visible to the next screen's read). Public/portal
 * screens go through the `/api/public/v1/volunteer/*` BFF (mocked by
 * `mockPublicApi`), which in production is a SEPARATE backend (FastAPI +
 * Mongo, not CouchDB) — `mockPublicApi`'s apply handler deliberately writes
 * the resulting `job_application`/`volunteer` docs into the SAME `world`
 * store so the two fakes stay consistent for the rest of the flow.
 *
 * The application doc created by the apply mock deliberately leaves
 * `volunteer_id: null` (the real server always resolves one — see
 * `server/public-application.ts`). Keeping it null here means approving in
 * step 4 falls back to `jobRepository().confirmSlot` instead of
 * auto-creating the shift assignment (`job-application.remote.ts#review`),
 * so step 5's manual "Assign Volunteers" screen still has real work to do.
 */

const BASE = 'http://localhost:4173';
const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const TODAY = new Intl.DateTimeFormat('en-CA', {
	timeZone: 'Asia/Bangkok',
	year: 'numeric',
	month: '2-digit',
	day: '2-digit'
}).format(new Date());
/** A day after `TODAY` — keeps the second job's shift from ever colliding with the
 * first job's (widened to fill most of `TODAY` so step 7 always finds it in-window). */
const TOMORROW = new Date(new Date(`${TODAY}T00:00:00Z`).getTime() + 24 * 60 * 60 * 1000)
	.toISOString()
	.slice(0, 10);

const ADMIN = {
	name: `volunteer_flow_e2e_sm_${RUN_ID}`,
	password: 'Password1!',
	roles: SM_SH001_ROLES,
	display_name: 'Volunteer Flow E2E SM'
};

const JOB_TITLE = `ช่วยแจกจ่ายอาหาร E2E ${RUN_ID}`;
const FULL_NAME = 'เก่งกล้า อาสา';
const APPLICANT_PHONE = '0891112222';

const SHELTER_DOC = {
	_id: 'shelter:SH001',
	type: 'shelter',
	schema_v: 5,
	code: 'SH001',
	name: 'ศูนย์พักพิง E2E Flow',
	site_kind: 'evacuation_center',
	operation_status: 'active',
	capacity: 100,
	zones: [],
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z'
};

const SKILL_ITEMS = [
	{
		code: 'cooking',
		label: 'ประกอบอาหาร / ครัวสนาม',
		category: 'operational',
		description: 'เตรียมและแจกจ่ายอาหาร',
		is_default: true,
		status: 'active'
	}
];

/** Already posted by someone else — the job the portal "apply for more" step (6) targets. */
const SECOND_JOB = {
	_id: `job:e2eflow${RUN_ID}second`,
	type: 'job' as const,
	schema_v: 3 as const,
	shelter_code: 'SH001',
	created_at: '2026-09-01T00:00:00.000Z',
	updated_at: '2026-09-01T00:00:00.000Z',
	created_by: 'volunteer-flow-e2e',
	title: `งานอาสา E2E จุดลงทะเบียนหน้างาน ${RUN_ID}`,
	description: 'ช่วยลงทะเบียนผู้ประสบภัยที่จุดคัดกรอง',
	tier: 'operational' as const,
	required_roles: [],
	skills_required: [],
	quota: 5,
	slots_confirmed: 0,
	slots_dispatched: 0,
	slots_remaining: 5,
	shifts: [
		{
			// A day after job 1's (widened to fill most of TODAY in step 1), so
			// applying never hits the booking-overlap guard
			// (`domain/collision.ts`) once the volunteer is already assigned to
			// job 1's shift by step 6.
			id: 'reg-1',
			date: TOMORROW,
			end_date: TOMORROW,
			start_time: '09:00',
			end_time: '12:00',
			quota: 5
		}
	],
	auto_accept: false,
	status: 'open' as const,
	is_urgent: false
};

type Doc = Record<string, unknown> & { _id: string; type?: string };
type Selector = Record<string, unknown>;

const json = (body: unknown, status = 200) => ({
	status,
	contentType: 'application/json',
	body: JSON.stringify(body)
});

function mintToken(): string {
	const bytes = Array.from({ length: 16 }, () => Math.floor(Math.random() * 256));
	return `TKT-VOL-${bytes
		.map((b) => b.toString(16).padStart(2, '0'))
		.join('')
		.toUpperCase()}`;
}

function normalizePhone(value: string): string {
	return value.replace(/[\s\-()]/g, '');
}

/** Mirrors `src/lib/db/hash.ts#sha256Hex` so the mock's stored hash fields are
 *  byte-identical to what production computes — no plaintext `phone`/`tracking_token`
 *  equivalent may be looked up any other way (docs/data/schema.md §2.8). */
async function sha256Hex(input: string): Promise<string> {
	const bytes = new TextEncoder().encode(input);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Enough of Mango's `selector` semantics for what this feature's repositories send. */
function matchSelector(doc: Doc, selector: Selector): boolean {
	if (doc._deleted) return false;
	for (const [key, cond] of Object.entries(selector)) {
		if (key === '$or') {
			if (!(cond as Selector[]).some((sub) => matchSelector(doc, sub))) return false;
			continue;
		}
		if (key === '$and') {
			if (!(cond as Selector[]).every((sub) => matchSelector(doc, sub))) return false;
			continue;
		}
		const value = doc[key];
		if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
			const ops = cond as Record<string, unknown>;
			if ('$in' in ops && !(ops.$in as unknown[]).includes(value)) return false;
			if ('$ne' in ops && value === ops.$ne) return false;
			continue;
		}
		if (value !== cond) return false;
	}
	return true;
}

/** A tiny in-memory CouchDB stand-in shared by `mockCouch` and `mockPublicApi`, keyed by `_id`. */
class World {
	private docs = new Map<string, Doc>();

	constructor(seed: Doc[]) {
		for (const doc of seed) this.docs.set(doc._id, doc);
	}

	upsert(doc: Doc): void {
		this.docs.set(doc._id, doc);
	}

	get(id: string): Doc | null {
		return this.docs.get(id) ?? null;
	}

	all(type?: string): Doc[] {
		const values = [...this.docs.values()].filter((d) => !d._deleted);
		return type ? values.filter((d) => d.type === type) : values;
	}
}

/**
 * Mocks the CouchDB HTTP boundary the back-office and on-site screens write to directly
 * — same shape as `volunteer-module.test.ts`'s `mockVolunteerCouch`, except PUT mutates
 * `world` in place instead of only recording a `writes` log, so a job created in step 1
 * is visible to step 4's applicants tab, a shift assigned in step 5 is visible to step 7's
 * on-site roster, and so on.
 */
async function mockCouch(page: Page, world: World): Promise<{ writes: Record<string, unknown>[] }> {
	const writes: Record<string, unknown>[] = [];
	let rev = 1;

	await page.route('**/*', async (route: Route) => {
		const url = new URL(route.request().url());
		const segments = url.pathname.split('/').filter(Boolean);
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
			const rows = (dbName === 'registry' ? [SHELTER_DOC] : world.all()).map((doc) => ({
				id: doc._id,
				doc
			}));
			await route.fulfill(json({ rows }));
			return;
		}

		if (segments[1] === '_find') {
			const body = (route.request().postDataJSON() ?? {}) as { selector?: Selector };
			const pool = dbName === 'registry' ? [SHELTER_DOC] : world.all();
			const found = body.selector
				? pool.filter((doc) => matchSelector(doc as Doc, body.selector!))
				: pool;
			await route.fulfill(json({ docs: found }));
			return;
		}

		if (segments.length === 2 && route.request().method() === 'GET') {
			const id = decodeURIComponent(segments[1]);
			const found =
				dbName === 'registry' ? (id === SHELTER_DOC._id ? SHELTER_DOC : null) : world.get(id);
			if (!found) {
				await route.fulfill(json({ error: 'not_found', reason: 'missing' }, 404));
				return;
			}
			await route.fulfill(json(found));
			return;
		}

		if (route.request().method() === 'PUT') {
			const body = route.request().postDataJSON() as Doc;
			writes.push(body);
			world.upsert({ ...body, _rev: `${++rev}-e2e` });
			await route.fulfill(json({ ok: true, id: segments[1], rev: `${rev}-e2e` }, 201));
			return;
		}

		if (route.request().method() === 'DELETE') {
			const id = decodeURIComponent(segments[1]);
			const existing = world.get(id);
			if (existing) world.upsert({ ...existing, _deleted: true });
			await route.fulfill(json({ ok: true, id: segments[1], rev: `${++rev}-e2e` }, 201));
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

	await page.route('**/api/v1/auth/me', (route) =>
		route.fulfill(
			json({
				name: ADMIN.name,
				display_name: ADMIN.display_name,
				roles: ADMIN.roles,
				must_change_password: false,
				has_security_question: true,
				mfa_enrolled: false,
				pending_mfa: false
			})
		)
	);

	return { writes };
}

function toPublicJob(job: Doc) {
	const shifts = (job.shifts as Doc[]) ?? [];
	return {
		job_id: job._id,
		shelter_code: job.shelter_code,
		shelter_name: SHELTER_DOC.name,
		title: job.title,
		description: job.description,
		tier: job.tier,
		skills_required: job.skills_required ?? [],
		shifts: shifts.map((s) => ({
			id: s.id,
			date: s.date,
			start_time: s.start_time,
			end_time: s.end_time,
			quota: s.quota,
			slots_confirmed: 0,
			applicants_count: 0
		})),
		quota: job.quota,
		slots_confirmed: job.slots_confirmed,
		slots_remaining: job.slots_remaining,
		status: job.status,
		requires_review: false
	};
}

function toPortalProfile(volunteer: Doc) {
	const skillCodes = (volunteer.skills as string[]) ?? [];
	const labels = skillCodes.map((code) => SKILL_ITEMS.find((s) => s.code === code)?.label ?? code);
	const phone = (volunteer.phone as string) ?? '';
	return {
		portal_id: (volunteer._id as string).split(':')[1],
		first_name: volunteer.first_name,
		last_name: volunteer.last_name,
		nickname: null,
		phone_masked: `xxx-xxx-${phone.slice(-4)}`,
		email: volunteer.email ?? null,
		volunteer_code: volunteer.volunteer_code,
		skills: labels,
		organization: volunteer.organization ?? null,
		identity_verified: volunteer.identity_verified,
		personnel_type: volunteer.personnel_type,
		shelter_codes: [volunteer.shelter_code]
	};
}

function toScheduleShift(world: World, a: Doc) {
	const job = world.get(a.job_id as string);
	const dutyWindow = a.duty_window as { start_ts: string; end_ts: string };
	return {
		assignment_id: a._id,
		job_id: a.job_id,
		job_title: (job?.title as string) ?? (a.station as string),
		shelter_code: a.shelter_code,
		shelter_name: SHELTER_DOC.name,
		date: a.date,
		shift: a.shift,
		station: a.station,
		start_ts: dutyWindow.start_ts,
		end_ts: dutyWindow.end_ts,
		check_in_at: a.check_in_at ?? null,
		check_out_at: a.check_out_at ?? null,
		status: a.status,
		dispatch_status: a.dispatch_status ?? null
	};
}

function findVolunteerByPhone(world: World, phone: string): Doc | null {
	const normalized = normalizePhone(phone);
	return world.all('volunteer').find((v) => v.phone === normalized) ?? null;
}

/** Mirrors `volunteerRepository().getByTrackingToken`'s normalize-then-hash lookup —
 *  the doc only ever carries `tracking_token_hash`, never the plaintext. */
async function findVolunteerByToken(world: World, token: string): Promise<Doc | null> {
	const hash = await sha256Hex(token.trim().toUpperCase());
	return world.all('volunteer').find((v) => v.tracking_token_hash === hash) ?? null;
}

/**
 * Mocks the public `/api/public/v1/volunteer/*` BFF — a separate fake backend in real
 * life (FastAPI + Mongo), reused here for both the anonymous job board (step 2) and the
 * signed-in Access Portal (step 6). The apply handler writes the resulting docs into
 * `world` so the back-office side (mocked by `mockCouch`) can see them.
 */
async function mockPublicApi(page: Page, world: World): Promise<void> {
	let volunteerCounter = 0;
	let applicationCounter = 0;

	await page.route('**/api/public/v1/config/volunteer-skills*', (route) =>
		route.fulfill(json({ volunteerSkills: SKILL_ITEMS }))
	);

	await page.route('**/api/public/v1/volunteer/jobs*', async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fallback();
			return;
		}
		const jobs = world
			.all('job')
			.filter((j) => j.status === 'open')
			.map(toPublicJob);
		await route.fulfill(json({ success: true, jobs, shelters: [SHELTER_DOC] }));
	});

	await page.route('**/api/public/v1/volunteer/apply/preflight', async (route) => {
		// Always `no_match`: the real endpoint would say `matched_one` for a phone
		// that already has a profile (as the applicant's does by step 6) and open
		// a "use your existing profile?" confirmation dialog — a public/anonymous
		// re-application concern this flow isn't testing, and one that needs a
		// fuller `existing_profile` payload than this fake bothers to build.
		await route.fulfill(
			json({
				success: true,
				match: 'no_match',
				message: 'ไม่พบ Volunteer profile เดิม สามารถสมัครใหม่ได้'
			})
		);
	});

	await page.route('**/api/public/v1/volunteer/jobs/*/apply', async (route) => {
		const url = new URL(route.request().url());
		const parts = url.pathname.split('/');
		const jobId = decodeURIComponent(parts[parts.indexOf('jobs') + 1]);
		const body = (route.request().postDataJSON() ?? {}) as {
			first_name?: string;
			last_name?: string;
			phone?: string;
			skills?: string[];
		};
		const job = world.get(jobId);
		if (!job) {
			await route.fulfill(json({ success: false, error: 'JOB_NOT_FOUND' }, 404));
			return;
		}
		const shift = (job.shifts as Doc[])[0];
		const phone = normalizePhone(body.phone ?? '');
		let volunteer = findVolunteerByPhone(world, phone);
		let volunteerToken: string | null = null;
		if (!volunteer) {
			volunteerToken = mintToken();
			const now = new Date().toISOString();
			volunteer = {
				_id: `volunteer:e2eflow${RUN_ID}${++volunteerCounter}`,
				type: 'volunteer',
				schema_v: 4,
				shelter_code: job.shelter_code,
				created_at: now,
				updated_at: now,
				created_by: 'public',
				first_name: body.first_name ?? '',
				last_name: body.last_name ?? '',
				phone,
				phone_hash: await sha256Hex(phone),
				email: null,
				skills: body.skills ?? [],
				organization: null,
				// Public apply never persists the plaintext role-card token to CouchDB —
				// only its hash (docs/data/schema.md §2.8). The plaintext is returned to
				// the caller once, in this route's `volunteer_token` response field.
				tracking_token: null,
				tracking_token_hash: await sha256Hex(volunteerToken),
				status: 'active',
				user_name: null,
				checked_in: false,
				current_shelter_code: null,
				volunteer_code: `V-E2E${volunteerCounter}`,
				identity_verified: false,
				identity_verification: {
					status: 'pending',
					reviewed_at: null,
					reviewed_by: null,
					notes: null
				},
				source: 'public_apply',
				personnel_type: 'volunteer'
			};
			world.upsert(volunteer);
		}
		const trackingToken = mintToken();
		const now = new Date().toISOString();
		const application: Doc = {
			_id: `job_application:e2eflow${RUN_ID}${++applicationCounter}`,
			type: 'job_application',
			schema_v: 3,
			shelter_code: job.shelter_code,
			created_at: now,
			updated_at: now,
			created_by: 'public',
			job_id: jobId,
			shift_id: shift.id,
			volunteer_id: null,
			applicant: {
				first_name: body.first_name ?? '',
				last_name: body.last_name ?? '',
				phone,
				phone_hash: await sha256Hex(phone),
				email: null,
				skills: body.skills ?? []
			},
			selected_shift: {
				shift_id: shift.id,
				date: shift.date,
				start_time: shift.start_time,
				end_time: shift.end_time
			},
			tracking_token: trackingToken,
			status: 'pending_review',
			review_notes: null,
			reviewed_at: null,
			reviewed_by: null,
			review_reasons: []
		};
		world.upsert(application);
		await route.fulfill(
			json({
				success: true,
				tracking_token: trackingToken,
				...(volunteerToken ? { volunteer_token: volunteerToken } : {}),
				status: application.status,
				job_id: jobId
			})
		);
	});

	await page.route('**/api/public/v1/volunteer/ticket/*', async (route) => {
		const url = new URL(route.request().url());
		const token = decodeURIComponent(url.pathname.split('/').pop() ?? '');
		if (token === 'find') {
			await route.fallback();
			return;
		}
		// The URL may carry either the per-application `tracking_token` or, on a
		// volunteer's first-ever application, the permanent per-volunteer
		// `volunteer_token` the apply handler minted instead (see
		// `public-quick-apply-modal.svelte`'s redirect logic) — resolve both. The
		// volunteer doc only ever carries the token's hash, never the plaintext.
		let application = world.all('job_application').find((a) => a.tracking_token === token);
		if (!application) {
			const tokenHash = await sha256Hex(token);
			const volunteer = world.all('volunteer').find((v) => v.tracking_token_hash === tokenHash);
			application = volunteer
				? world
						.all('job_application')
						.filter((a) => (a.applicant as Doc).phone === volunteer.phone)
						.sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0]
				: undefined;
		}
		if (!application) {
			await route.fulfill(json({ success: false, error: 'TICKET_NOT_FOUND' }, 404));
			return;
		}
		const job = world.get(application.job_id as string);
		const applicant = application.applicant as Doc;
		const shift = application.selected_shift as Doc;
		await route.fulfill(
			json({
				success: true,
				ticket: {
					token,
					can_cancel: true,
					status: application.status,
					job_id: application.job_id,
					job_title: job?.title,
					shelter_code: application.shelter_code,
					shelter_name: SHELTER_DOC.name,
					applicant_name: `${applicant.first_name} ${applicant.last_name}`,
					phone_masked: `xxx-xxx-${String(applicant.phone).slice(-4)}`,
					skills: applicant.skills,
					selected_shift: {
						date: shift.date,
						start_time: shift.start_time,
						end_time: shift.end_time,
						station: job?.title ?? null
					},
					applied_at: application.created_at,
					qr_payload: `/volunteer/ticket/${token}`
				}
			})
		);
	});

	const credentialVolunteer = async (body: {
		phone?: string;
		token?: string;
	}): Promise<Doc | null> =>
		body.phone
			? findVolunteerByPhone(world, body.phone)
			: body.token
				? await findVolunteerByToken(world, body.token)
				: null;

	await page.route('**/api/public/v1/volunteer/access/resolve', async (route) => {
		const body = (route.request().postDataJSON() ?? {}) as { phone?: string; token?: string };
		const volunteer = await credentialVolunteer(body);
		await route.fulfill(
			json({ success: true, profile: volunteer ? toPortalProfile(volunteer) : null })
		);
	});

	await page.route('**/api/public/v1/volunteer/profile', async (route) => {
		const body = (route.request().postDataJSON() ?? {}) as { phone?: string; token?: string };
		const volunteer = await credentialVolunteer(body);
		await route.fulfill(
			json({ success: true, profile: volunteer ? toPortalProfile(volunteer) : null })
		);
	});

	await page.route('**/api/public/v1/volunteer/schedule', async (route) => {
		const body = (route.request().postDataJSON() ?? {}) as { phone?: string; token?: string };
		const volunteer = await credentialVolunteer(body);
		const shifts = volunteer
			? world
					.all('shift_assignment')
					.filter((a) => a.volunteer_id === volunteer!._id)
					.map((a) => toScheduleShift(world, a))
			: [];
		await route.fulfill(json({ success: true, shifts }));
	});
}

/** The public job board / portal openings tab list several job cards on one page —
 * scope to the smallest ancestor that holds both the title and its own apply button. */
function jobCard(page: Page, title: string) {
	return page
		.locator('div')
		.filter({ hasText: title })
		.filter({ has: page.getByRole('button', { name: 'สมัครกะนี้' }) })
		.last();
}

test.describe('Volunteer end-to-end operational flow', () => {
	let adminSession = '';

	test.beforeAll(async () => {
		await createCouchUser(ADMIN);
		adminSession = await couchLogin(ADMIN.name, ADMIN.password);
	});

	test.afterAll(async () => {
		await deleteCouchUser(ADMIN.name);
	});

	test('create job → public apply → review → assign → portal re-apply → check-in/out', async ({
		page
	}) => {
		const world = new World([SECOND_JOB]);
		const { writes } = await mockCouch(page, world);
		await mockPublicApi(page, world);

		let jobId = '';
		let volunteerToken = '';

		await test.step('1. Admin creates a job with one shift', async () => {
			await injectSession(page, ADMIN, adminSession);
			await page.goto(`${BASE}/back-office/volunteers`);
			await expect(page.getByText('Smart Volunteer Control Hub')).toBeVisible();

			await page.getByRole('button', { name: 'ประกาศภารกิจงานอาสาใหม่', exact: true }).click();
			const dialog = page.getByRole('dialog');
			await expect(dialog.getByLabel(/หัวข้อภารกิจอาสา/)).toBeVisible();

			await dialog.getByLabel(/หัวข้อภารกิจอาสา/).fill(JOB_TITLE);
			await dialog
				.getByLabel(/รายละเอียดงาน/)
				.fill('แจกจ่ายอาหารกลางวันให้ผู้พักพิงที่จุดครัวกลาง');
			await dialog.getByRole('button', { name: 'เปิดรับ' }).click();
			await dialog
				.locator('label', { hasText: SKILL_ITEMS[0].label })
				.getByRole('checkbox')
				.click();

			await dialog.locator('label', { hasText: 'วันที่ทำงาน' }).getByRole('button').click();
			await page.locator('[data-today]').first().click();
			await dialog.getByRole('button', { name: 'เพิ่มกะ' }).click();
			await expect(dialog.getByText(/รับ 5 คน/)).toBeVisible();

			await dialog.getByRole('button', { name: /บันทึกและเผยแพร่/ }).click();
			// The dialog only closes once the create mutation resolves — a more
			// reliable success signal than the toast, which can dismiss before a
			// slow/loaded CI runner's next `expect` poll catches it.
			await expect(dialog).toHaveCount(0);

			const created = writes.find((w) => w.type === 'job' && w.title === JOB_TITLE);
			expect(created, 'job PUT was captured').toBeTruthy();
			jobId = created!._id as string;
			expect((created!.shifts as unknown[]).length).toBe(1);

			// The form's shift defaults to a fixed 08:00–16:00 window, which step 7's
			// check-in would only fall inside during part of the day. Widen it in
			// `world` directly (rather than fighting the DatePicker/TimePicker's
			// calendar+dropdown UI for a value that has to track "now") so the
			// duty window safely contains whatever time this suite actually runs at.
			const existingJob = world.get(jobId)!;
			const widened: Doc = {
				...existingJob,
				shifts: (existingJob.shifts as Doc[]).map((s) => ({
					...s,
					start_time: '00:00',
					end_time: '23:55'
				}))
			};
			world.upsert(widened);

			await clearSession(page);
		});

		await test.step('2. Public applies to the shift from the job board', async () => {
			await page.goto(`${BASE}/volunteers/jobs`);
			await expect(page.getByText(JOB_TITLE)).toBeVisible();
			await jobCard(page, JOB_TITLE).getByRole('button', { name: 'สมัครกะนี้' }).first().click();

			const form = page.locator('form');
			await form.locator('#firstName').fill('เก่งกล้า');
			await form.locator('#lastName').fill('อาสา');
			await form.locator('#phone').fill(APPLICANT_PHONE);
			await form.getByRole('button', { name: SKILL_ITEMS[0].label }).click();
			await form.locator('label', { hasText: 'PDPA' }).getByRole('checkbox').check();
			await form.getByRole('button', { name: /ยืนยันการสมัครและรับตั๋วดิจิทัล/ }).click();

			await expect(page).toHaveURL(/\/volunteer\/ticket\//);
			await expect(page.getByRole('img', { name: 'QR Code สำหรับรายงานตัวหน้างาน' })).toBeVisible();
			await expect(page.getByText(FULL_NAME)).toBeVisible();

			// The plaintext role-card token only ever exists in this one-time redirect
			// (`public-quick-apply-modal.svelte`'s `volunteer_token` handling) — the
			// "CouchDB" doc stores only `tracking_token_hash`, so step 7 must capture the
			// plaintext here rather than reading it back off the volunteer doc.
			volunteerToken = decodeURIComponent(new URL(page.url()).pathname.split('/').pop() ?? '');
			expect(volunteerToken).toMatch(/^TKT-VOL-/);

			const application = world.all('job_application').find((a) => a.job_id === jobId);
			expect(application?.status).toBe('pending_review');
		});

		await test.step("3. Admin verifies the volunteer's identity on the People tab", async () => {
			// A separate, volunteer-level audit (`volunteer-qualification-dialog.svelte`)
			// from the job-application decision in the next step — it records
			// identity/controlled-skill evidence and is the gate step 7's on-site
			// check-in actually checks (`blockedByIdentity`), not the application review.
			await injectSession(page, ADMIN, adminSession);
			await page.goto(`${BASE}/back-office/volunteers?tab=people`);
			await expect(page.getByRole('heading', { name: 'จัดการอาสาสมัคร' })).toBeVisible();

			const row = page.locator('tr', { hasText: FULL_NAME });
			await expect(row).toBeVisible();
			await expect(row.getByText('รอยืนยันตัวตน')).toBeVisible();
			await row.getByRole('button', { name: 'ตรวจสอบ & อนุมัติ' }).click();

			const dialog = page.getByRole('dialog');
			await expect(dialog.getByRole('heading', { name: /ตรวจสอบคุณสมบัติ/ })).toBeVisible();
			// No controlled skill on this applicant ('cooking' isn't one) — the default
			// "controlled" radio behaves as a plain identity approval here.
			await dialog.getByRole('button', { name: 'ยืนยันตัวตนและอนุมัติ' }).click();
			await expect(dialog).toHaveCount(0);

			await expect
				.poll(
					() => world.all('volunteer').find((v) => v.phone === APPLICANT_PHONE)?.identity_verified
				)
				.toBe(true);
		});

		await test.step('4. Admin reviews and approves the application', async () => {
			await page.goto(`${BASE}/back-office/volunteers/jobs/${encodeURIComponent(jobId)}`);
			await expect(page.getByRole('heading', { name: JOB_TITLE })).toBeVisible();

			await page.getByRole('tab', { name: /ผู้สมัคร/ }).click();
			await expect(page.getByText(FULL_NAME)).toBeVisible();
			await page.getByRole('button', { name: 'อนุมัติเข้าร่วมปฏิบัติงาน' }).click();

			const dialog = page.getByRole('dialog');
			await expect(dialog).toBeVisible();
			await dialog.getByRole('button', { name: 'ยืนยันอนุมัติ' }).click();
			await expect(dialog).toHaveCount(0);

			const application = world.all('job_application').find((a) => a.job_id === jobId);
			expect(application?.status).toBe('confirmed');
			// Deliberately not auto-assigned — see the file header comment.
			expect(world.all('shift_assignment').some((a) => a.job_id === jobId)).toBe(false);
		});

		await test.step('5. The job creator manually assigns the volunteer to the shift', async () => {
			await page.goto(`${BASE}/back-office/volunteers/jobs/${encodeURIComponent(jobId)}/assign`);
			await expect(page.getByRole('heading', { name: /มอบหมายอาสาเข้ากะ/ })).toBeVisible();

			const row = page.locator('li', { hasText: FULL_NAME });
			await expect(row).toBeVisible();
			await row.getByRole('button', { name: 'มอบหมาย' }).click();
			// No dialog to gate on here, and the success toast can dismiss before a
			// slow runner's next poll — wait on the actual write landing instead.
			await expect
				.poll(() => world.all('shift_assignment').find((a) => a.job_id === jobId)?.status)
				.toBe('standby');

			const assignment = world.all('shift_assignment').find((a) => a.job_id === jobId);
			expect(assignment?.dispatch_status).toBe('accepted');

			await clearSession(page);
		});

		await test.step('6. The volunteer signs into the portal and applies to a second job', async () => {
			await page.goto(`${BASE}/volunteers/portal`);
			await expect(page.locator('#volunteer-phone-input')).toBeVisible();
			await page.locator('#volunteer-phone-input').fill(APPLICANT_PHONE);
			await page.getByRole('button', { name: 'เข้าสู่ระบบทันที' }).click();

			await expect(page.getByTitle('สลับบัญชี / ออกจากระบบ')).toBeVisible();
			// The shift assigned in step 5 already shows up on the volunteer's own schedule.
			await expect(page.getByText(JOB_TITLE).first()).toBeVisible();

			await page.getByRole('button', { name: /งานจิตอาสา/ }).click();
			await expect(page).toHaveURL(/\/openings$/);
			await expect(page.getByText(SECOND_JOB.title)).toBeVisible();

			await jobCard(page, SECOND_JOB.title)
				.getByRole('button', { name: 'สมัครกะนี้' })
				.first()
				.click();
			const form = page.locator('form');
			await form.locator('label', { hasText: 'PDPA' }).getByRole('checkbox').check();
			await form.getByRole('button', { name: /ยืนยันการสมัครและรับตั๋วดิจิทัล/ }).click();

			// A signed-in portal applicant already has a profile — no fresh ticket to view;
			// the modal just closes back onto the openings board.
			await expect(form).toHaveCount(0);

			const secondApplication = world
				.all('job_application')
				.find((a) => a.job_id === SECOND_JOB._id);
			expect(secondApplication).toBeTruthy();

			await clearSession(page);
		});

		await test.step('7. On-site staff check the volunteer in, then out, by their token', async () => {
			await injectSession(page, ADMIN, adminSession);
			await page.goto(`${BASE}/onsite/volunteer-check-in`);
			await expect(page.getByRole('heading', { name: /จุดเช็คอินอาสาสมัครหน้างาน/ })).toBeVisible();

			const volunteer = world.all('volunteer').find((v) => v.phone === APPLICANT_PHONE);
			expect(
				volunteer,
				'volunteer profile from step 2, verified in step 3, must exist'
			).toBeTruthy();

			await page.getByPlaceholder('พิมพ์เบอร์โทร, ชื่อ, หรือ Token...').fill(volunteerToken);
			await page.getByRole('button', { name: new RegExp(FULL_NAME) }).click();

			await page.getByRole('button', { name: 'เช็คอิน' }).click();
			// The result card only offers check-out once the assignment is actually
			// `checked_in` — a real state gate (unlike the toast, which can dismiss
			// before a slow runner's next poll catches it) and the precondition for
			// the next click anyway.
			const checkOutButton = page.getByRole('button', {
				name: 'กดยืนยันเช็คเอาต์ออกงาน (Check-Out)'
			});
			await expect(checkOutButton).toBeVisible();

			await checkOutButton.click();
			await expect
				.poll(() => world.all('shift_assignment').find((a) => a.job_id === jobId)?.status)
				.toBe('completed');

			const assignment = world.all('shift_assignment').find((a) => a.job_id === jobId);
			expect(assignment?.check_in_method).toBe('qr');
			expect(assignment?.check_out_method).toBe('qr');
		});
	});
});
