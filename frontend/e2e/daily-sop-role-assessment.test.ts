/**
 * Daily SOP role assessments (CR-153) — every position assesses only its own SOP tasks.
 *
 * One suite, own `E2E` shelter per run (never SH001). Setup goes through the staff UI (shelter)
 * and CouchDB `_users` (one single-capability account per position + an SA and a no-position
 * account). Covers, for all nine positions:
 *   - visibility: an account lists only the positions it may assess (SM and SA see all nine; SC
 *     includes `warehouse_staff`; no position → an empty-state message)
 *   - owner positive: a partial save is `InProgress`, completing it is `Completed` (success dialog);
 *     the "last saved by" line shows only on answered questions
 *   - cross-role negative: a deep link to another position is denied in the UI **and** a live PUT
 *     straight to CouchDB is refused by the VDU (403, "role owner or shelter manager")
 *   - the page hides question codes; the wording matches the canonical question bank
 *   - a past date is read-only, and the VDU refuses to create a past-day document
 *   - notes: Fail saves without a note; Pending without a note is refused (UI and VDU)
 *   - metric questions: with SOP parameters only Pass/Fail are offered, without them only "Pending"
 *
 * Data safety: role assessment documents cannot be deleted (the VDU forbids DELETE for everyone,
 * `_admin` included), so they live and die with the shelter database. `teardownShelter` drops that
 * database, so nothing is left behind; the last test asserts it. Accounts are removed too.
 * Every note carries the `E2E` marker and the run id.
 *
 * Tags: `@daily-sop` + `@critical` (+ `@back-office`). Runs locally, or on a remote target with
 * `ALLOW_REMOTE_WRITES=true`; skipped (read-only) otherwise. Bangkok-date based: the run is skipped
 * when it starts within 10 minutes of Bangkok midnight (the VDU only accepts "today").
 *
 * Local: `docker compose up -d`, `pnpm seed:master`, then
 *   pnpm exec vite build --mode test
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:4173 pnpm exec playwright test \
 *     e2e/daily-sop-role-assessment.test.ts
 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import {
	bootstrapAdminSession,
	COUCH_BASE,
	couchLogin,
	couchReq,
	createCouchUser,
	deleteCouchUser,
	getDocument,
	seedSecurityQuestion,
	type CouchDocument,
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { clearSession, injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi, pinActiveShelter } from './helpers/staff-ui';
import { roleDisplayLabel } from '../src/lib/auth/roles';
import { bangkokToday } from '../src/lib/utils/date';
import {
	DAILY_SOP_ROLES,
	questionsForRole,
	type DailySopRoleCode
} from '../src/lib/features/daily-sop/domain/daily-sop';

/** Id of this spec's created-data ledger (see helpers/public-cleanup.ts). */
const LEDGER_SUITE = 'daily-sop-role-assessment';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const PASSWORD = 'Password1!';
const MARKER = `E2E DailySOP ${RUN_ID}`;
const ROLE_CODES = DAILY_SOP_ROLES.map((role) => role.code);
/** Owners that may only assess their own position (SM is allowed everywhere). */
const RING = ROLE_CODES.filter((code) => code !== 'SM');

// ─── Dates (Asia/Bangkok — the VDU accepts only "today") ───────────────────────

function shiftDays(date: string, delta: number): string {
	const day = new Date(`${date}T12:00:00+07:00`);
	day.setUTCDate(day.getUTCDate() + delta);
	return bangkokToday(day);
}

const TODAY = bangkokToday();
const YESTERDAY = shiftDays(TODAY, -1);
const MS_UNTIL_BANGKOK_MIDNIGHT =
	new Date(`${shiftDays(TODAY, 1)}T00:00:00+07:00`).getTime() - Date.now();

// ─── Run state ─────────────────────────────────────────────────────────────────

type Account = {
	key: string;
	user: TestUser;
	session: string;
	/** The position this account owns (null for SA and the no-position account). */
	ownRole: DailySopRoleCode | null;
	/** SM and SA may assess every position. */
	assessesAll: boolean;
};

let shelterCode: string | undefined;
let accounts: Account[] = [];
let liveWritesStarted = false;
let tab: Page | undefined;
let signedInAs: string | undefined;
/** The tab's latest CouchDB PUT answers — shown when a save does not land. */
const puts: string[] = [];
/** Requests the tab made to any shelter database other than this run's (blocked, never sent). */
let strayShelterRequests = 0;

/** Question codes (`D-XX-NN`) are internal; the page must not show them. */
const QUESTION_CODE = /D-[A-Z]{2,3}-\d{2}/;

const roleByCode = (code: DailySopRoleCode) => DAILY_SOP_ROLES.find((role) => role.code === code)!;
const labelOf = (code: DailySopRoleCode) => roleDisplayLabel(roleByCode(code).key);
const dbName = () => `shelter_${shelterCode!.toLowerCase()}`;
const docId = (role: DailySopRoleCode, date = TODAY) =>
	`daily_sop_role_assessment:${shelterCode}:${date}:${role}`;
const readDoc = (role: DailySopRoleCode, date = TODAY) => getDocument(dbName(), docId(role, date));
const ownerOf = (role: DailySopRoleCode) => accounts.find((a) => a.key === `own-${role}`)!;
const accountByKey = (key: string) => accounts.find((a) => a.key === key)!;
const mayAssess = (account: Account, code: DailySopRoleCode) =>
	account.assessesAll || code === account.ownRole;
const assessableCodes = (account: Account) => ROLE_CODES.filter((code) => mayAssess(account, code));

async function provisionAccounts(code: string): Promise<void> {
	const specs: Array<{
		key: string;
		roles: string[];
		ownRole: DailySopRoleCode | null;
		all: boolean;
	}> = [
		...DAILY_SOP_ROLES.map((role) => ({
			key: `own-${role.code}`,
			roles: [`shelter:${code}`, role.capabilities[0]],
			ownRole: role.code,
			all: role.code === 'SM'
		})),
		{ key: 'warehouse', roles: [`shelter:${code}`, 'warehouse_staff'], ownRole: 'SC', all: false },
		{ key: 'sa', roles: ['system_admin'], ownRole: null, all: true },
		{ key: 'none', roles: [`shelter:${code}`, 'distribution_staff'], ownRole: null, all: false }
	];
	accounts = [];
	for (const spec of specs) {
		const user: TestUser = {
			name: `dsop_${spec.key.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${RUN_ID}`,
			password: PASSWORD,
			roles: spec.roles,
			display_name: `${MARKER} ${spec.key}`
		};
		await createCouchUser(user);
		await seedSecurityQuestion(user.name);
		accounts.push({
			key: spec.key,
			user,
			session: await couchLogin(user.name, user.password),
			ownRole: spec.ownRole,
			assessesAll: spec.all
		});
	}
}

/**
 * One browser tab for the whole run (e2e/README.md §5): the next account's session is injected
 * with `injectSession` after the previous one was cleared — no extra tabs or contexts.
 */
async function pageFor(browser: Browser, account: Account): Promise<Page> {
	if (!tab || tab.isClosed()) {
		const context = await browser.newContext();
		tab = await context.newPage();
		await routeBrowserCouchThroughApp(tab);
		signedInAs = undefined;
		// The app may fall back to another shelter (e.g. SA when the list has not loaded ours yet).
		// Never let this suite touch one: block every other shelter database.
		await tab.route(
			(url) =>
				/\/shelter_sh\d+(\/|$)/i.test(url.pathname) &&
				!url.pathname.toLowerCase().includes(`/shelter_${shelterCode!.toLowerCase()}`),
			(route) => {
				strayShelterRequests += 1;
				return route.abort();
			}
		);
		tab.on('response', (res) => {
			if (res.request().method() !== 'PUT') return;
			puts.push(`${res.status()} ${decodeURIComponent(res.url().split('/').pop() ?? '')}`);
			if (puts.length > 12) puts.shift();
		});
	}
	if (signedInAs === account.key) return tab;
	if (signedInAs) await clearSession(tab);
	await injectSession(tab, account.user, account.session);
	await pinActiveShelter(tab, shelterCode!);
	signedInAs = account.key;
	return tab;
}

async function closePages(): Promise<void> {
	await tab
		?.context()
		.close()
		.catch(() => undefined);
	tab = undefined;
	signedInAs = undefined;
}

// ─── UI helpers ────────────────────────────────────────────────────────────────

const saveButton = (page: Page) =>
	page.getByRole('button', { name: /^บันทึก(ผลประเมิน|ความคืบหน้า)$/ });
const radio = (page: Page, questionId: string, value: 'Pass' | 'Fail' | 'Pending') =>
	page.locator(`input[name="daily-sop-${questionId}"][value="${value}"]`);

/** Open `path` in the E2E shelter: pin it, and redo the visit if the app wandered to another. */
async function gotoInOurShelter(
	page: Page,
	path: string,
	ready: () => Promise<void>
): Promise<void> {
	for (let attempt = 1; attempt <= 3; attempt++) {
		strayShelterRequests = 0;
		await pinActiveShelter(page, shelterCode!);
		await page.goto(path);
		const ok = await ready().then(
			() => true,
			(error) => {
				// An empty page next to blocked requests means the app left our shelter: try again.
				if (strayShelterRequests === 0) throw error;
				return false;
			}
		);
		if (ok && strayShelterRequests === 0) return;
	}
	throw new Error(`the app kept leaving the E2E shelter ${shelterCode} (${path})`);
}

async function openRole(page: Page, role: DailySopRoleCode, date = TODAY): Promise<void> {
	await gotoInOurShelter(
		page,
		`/back-office/dailysop?view=roles&role=${role}&date=${date}`,
		async () => {
			await expect(page.getByRole('heading', { level: 1, name: labelOf(role) })).toBeVisible({
				timeout: 30_000
			});
			await expect(radio(page, questionsForRole(role)[0].id, 'Pass')).toBeAttached({
				timeout: 30_000
			});
		}
	);
}

/** Status radios are visually hidden: click the label the user clicks. */
async function choose(page: Page, questionId: string, value: 'Pass' | 'Fail' | 'Pending') {
	const label = page.locator(`label:has(input[name="daily-sop-${questionId}"][value="${value}"])`);
	// Centre it first: the sticky save bar would cover a label scrolled to the bottom edge.
	await label.evaluate((el) => el.scrollIntoView({ block: 'center' }));
	await label.click();
}

async function note(page: Page, questionId: string, text: string) {
	await page.locator(`#daily-sop-${questionId}-notes`).fill(text);
}

/**
 * Answer the first `count` questions (all when omitted). The first answer is a Fail with a note
 * (`withFail`); a question whose SOP ratio parameter is missing only offers "Pending", which
 * needs a note too — that is the metric Pending path.
 */
async function answer(
	page: Page,
	role: DailySopRoleCode,
	opts: { count?: number; withFail?: boolean } = {}
): Promise<void> {
	const questions = questionsForRole(role).slice(0, opts.count);
	for (const [index, question] of questions.entries()) {
		const passEnabled = await radio(page, question.id, 'Pass').isEnabled();
		if (!passEnabled) {
			await choose(page, question.id, 'Pending');
			await note(page, question.id, `${MARKER} pending: no SOP parameter`);
		} else if (index === 0 && opts.withFail) {
			await choose(page, question.id, 'Fail');
			await note(page, question.id, `${MARKER} fail`);
		} else {
			await choose(page, question.id, 'Pass');
		}
	}
}

type Chosen = 'Pass' | 'Fail' | 'Pending';

/**
 * Answer every question, top to bottom, with a mix of Pass and Fail (a Fail needs a note).
 * `offset` flips the pattern so a later account really changes what an earlier one saved. A
 * metric question without its SOP parameter only offers "Pending", which needs a note too.
 */
async function answerMixed(
	page: Page,
	role: DailySopRoleCode,
	offset: 0 | 1,
	who: string
): Promise<Chosen[]> {
	const chosen: Chosen[] = [];
	for (const [index, question] of questionsForRole(role).entries()) {
		const failable = await radio(page, question.id, 'Fail').isEnabled();
		const passable = await radio(page, question.id, 'Pass').isEnabled();
		let value: Chosen = (index + offset) % 2 === 0 ? 'Pass' : 'Fail';
		if (!passable || !failable) value = 'Pending';
		await choose(page, question.id, value);
		if (value !== 'Pass') await note(page, question.id, `${MARKER} ${value} by ${who}`);
		chosen.push(value);
	}
	return chosen;
}

/** The page lists exactly this position's questions, in order, with the domain wording. */
async function expectQuestionsMatch(page: Page, role: DailySopRoleCode): Promise<void> {
	const questions = questionsForRole(role);
	const sections = page.locator('section[id^="role-question-"]');
	await expect(sections, `${role} question count`).toHaveCount(questions.length);
	for (const [index, question] of questions.entries()) {
		const section = sections.nth(index);
		// A ratio placeholder is filled in by the page: compare the wording before it.
		const wording = question.text.split('{')[0].trim();
		await expect(section.locator('h3').first(), `${question.id} wording`).toContainText(wording);
	}
	await expect(page.getByText(QUESTION_CODE), `${role} shows no question codes`).toHaveCount(0);
}

/** A deep link to a position this account may not assess is denied, with no form behind it. */
async function openDenied(page: Page, role: DailySopRoleCode, date = TODAY): Promise<void> {
	await gotoInOurShelter(
		page,
		`/back-office/dailysop?view=roles&role=${role}&date=${date}`,
		async () => {
			await expect(page.getByTestId('daily-sop-role-no-access')).toBeVisible({ timeout: 30_000 });
		}
	);
	await expect(page.locator('section[id^="role-question-"]')).toHaveCount(0);
	await expect(saveButton(page)).toHaveCount(0);
}

/** The "last saved by" audit line of one question. */
const auditLine = (page: Page, questionId: string) =>
	page.locator(`section[id="role-question-${questionId}"]`).getByText(/^บันทึกล่าสุดโดย /);

async function saveAndConfirm(page: Page): Promise<void> {
	await expect(saveButton(page)).toBeEnabled();
	await saveButton(page).click();
	const dialog = page.getByTestId('role-save-success-dialog');
	await expect(dialog).toBeVisible({ timeout: 30_000 });
	await page.keyboard.press('Escape');
	await expect(dialog).toBeHidden();
}

async function expectReadOnly(page: Page): Promise<void> {
	await expect(page.getByText('ดูอย่างเดียว', { exact: true })).toBeVisible();
	await expect(saveButton(page)).toHaveCount(0);
	await expect(page.locator('input[type="radio"]:not(:disabled)')).toHaveCount(0);
}

async function expectEditable(page: Page): Promise<void> {
	await expect(page.getByText('ดูอย่างเดียว', { exact: true })).toHaveCount(0);
	await expect(page.locator('input[type="radio"]:not(:disabled)').first()).toBeAttached();
}

// ─── Live CouchDB probes (what the VDU enforces on its own) ────────────────────

async function couchAs(session: string, method: 'GET' | 'PUT', id: string, body?: unknown) {
	const res = await fetch(`${COUCH_BASE}/${dbName()}/${encodeURIComponent(id)}`, {
		method,
		headers: {
			Cookie: `AuthSession=${session}`,
			'Content-Type': 'application/json',
			Accept: 'application/json'
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
	return { status: res.status, data, reason: String(data.reason ?? data.error ?? '') };
}

/** A valid update of an existing document: only `updated_at` moves. */
async function touchAs(account: Account, role: DailySopRoleCode) {
	const read = await couchAs(account.session, 'GET', docId(role));
	expect(read.status, `${account.key} may read ${role}`).toBe(200);
	return couchAs(account.session, 'PUT', docId(role), {
		...read.data,
		updated_at: new Date().toISOString()
	});
}

// ─── Suite ─────────────────────────────────────────────────────────────────────

test.afterAll(async () => {
	test.setTimeout(180_000);
	await closePages();
	if (!CAN_WRITE || !liveWritesStarted) return;
	if (shelterCode) await teardownShelter(shelterCode).catch(() => undefined);
	for (const account of accounts) await deleteCouchUser(account.user.name).catch(() => undefined);
});

test.describe(
	'Daily SOP role assessments (CR-153) on an own E2E shelter',
	{ tag: ['@daily-sop', '@critical', '@back-office'] },
	() => {
		// eslint-disable-next-line no-empty-pattern -- Playwright needs a destructured first argument
		test.beforeEach(({}, testInfo) => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
			test.skip(
				!shelterCode && !testInfo.title.startsWith('provision'),
				'no E2E shelter this run (provisioning was skipped near Bangkok midnight)'
			);
		});

		test('provision an E2E shelter and one account per position', async ({ page }) => {
			test.setTimeout(240_000);
			test.skip(
				MS_UNTIL_BANGKOK_MIDNIGHT < 10 * 60_000,
				'within 10 minutes of Bangkok midnight — the VDU only accepts today'
			);
			liveWritesStarted = true;
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			shelterCode = await createShelterViaUi(page, {
				name: `E2E Daily SOP ${RUN_ID}`,
				siteKind: 'evacuation_center',
				lat: 7.006,
				lng: 100.498,
				subdistrict: 'คอหงส์',
				capacity: 60
			});
			recordCreatedShelter(shelterCode, LEDGER_SUITE);
			await provisionAccounts(shelterCode);
			// SA, nine positions, the SC alias (warehouse_staff) and a no-position account.
			expect(accounts).toHaveLength(DAILY_SOP_ROLES.length + 3);
		});

		test('each account lists only the positions it may assess', async ({ browser }) => {
			test.setTimeout(300_000);
			for (const account of accounts) {
				const page = await pageFor(browser, account);
				const codes = assessableCodes(account);
				const actions = page.getByRole('button', { name: /^(ประเมิน|ดูผลประเมิน): / });
				if (codes.length === 0) {
					await gotoInOurShelter(page, `/back-office/dailysop?view=roles&date=${TODAY}`, () =>
						expect(page.getByTestId('daily-sop-no-roles')).toBeVisible({ timeout: 30_000 })
					);
					await expect(actions).toHaveCount(0);
					continue;
				}
				await gotoInOurShelter(page, `/back-office/dailysop?view=roles&date=${TODAY}`, () =>
					expect(actions, `${account.key} rows`).toHaveCount(codes.length, { timeout: 30_000 })
				);
				for (const code of codes) {
					await expect(
						page.getByRole('button', { name: `ประเมิน: ${labelOf(code)}` }),
						`${account.key} → ${code}`
					).toHaveCount(1);
				}
			}
		});

		test('the day list opens and lists today', async ({ browser }) => {
			const page = await pageFor(browser, ownerOf('REG'));
			await gotoInOurShelter(page, '/back-office/dailysop', async () => {
				await expect(page.getByTestId('daily-sop-days-view')).toBeVisible({ timeout: 30_000 });
				await expect(page.getByTestId('daily-sop-day-list')).toBeVisible();
			});
			// No position: nothing to assess, so no day list either.
			const none = await pageFor(browser, accountByKey('none'));
			await gotoInOurShelter(none, '/back-office/dailysop', () =>
				expect(none.getByTestId('daily-sop-no-roles')).toBeVisible({ timeout: 30_000 })
			);
			await expect(none.getByTestId('daily-sop-day-list')).toHaveCount(0);
		});

		// ── One walkthrough per account: sign in, every position top to bottom, sign out ──
		// Own position: a partial save is InProgress, the full mixed answer is Completed. Another
		// position: the deep link is denied, and a live PUT is refused by the VDU.
		// SM goes first: it may assess every position, so it creates the documents the others read.
		const WALK = ['own-SM', ...RING.map((code) => `own-${code}`), 'warehouse', 'none', 'sa'];
		for (const key of WALK) {
			test(`walkthrough ${key}: every position top to bottom`, async ({ browser }) => {
				test.setTimeout(900_000);
				const account = accountByKey(key);
				const page = await pageFor(browser, account);
				for (const code of ROLE_CODES) {
					if (!mayAssess(account, code)) {
						await openDenied(page, code);
						const denied = await touchAs(account, code);
						expect(denied.status, `${key} must not write ${code}`).toBe(403);
						expect(denied.reason).toMatch(/role owner or shelter manager/);
						continue;
					}
					await openRole(page, code);
					await expectQuestionsMatch(page, code);
					await expectEditable(page);
					const total = questionsForRole(code).length;
					const existing = await readDoc(code);
					const fresh = existing === null;
					// Flip the first answer of whatever an earlier account saved: every save is a real change.
					const first = (existing?.controls as Array<{ status: string }> | undefined)?.[0];
					const offset = first?.status === 'Pass' ? 1 : 0;
					if (fresh) {
						await answer(page, code, { count: 2 });
						await saveAndConfirm(page);
						const partial = await readDoc(code);
						expect(partial).toMatchObject({
							status: 'InProgress',
							role_code: code,
							created_by: account.user.name,
							assessment_date: TODAY
						});
						expect(partial!.unanswered_count).toBe(total - 2);
						await openRole(page, code);
						// The audit line belongs to answered questions only.
						const [firstQuestion, , unanswered] = questionsForRole(code);
						await expect(auditLine(page, firstQuestion.id)).toBeVisible();
						if (unanswered) await expect(auditLine(page, unanswered.id)).toHaveCount(0);
					}
					const chosen = await answerMixed(page, code, offset, key);
					await saveAndConfirm(page);
					expect(strayShelterRequests, 'the save stayed in the E2E shelter').toBe(0);
					try {
						await expect
							.poll(
								async () =>
									((await readDoc(code))?.controls as Array<{ status: string }>).map(
										(c) => c.status
									),
								{ timeout: 20_000 }
							)
							.toEqual(chosen);
					} catch (error) {
						throw new Error(
							`${key} → ${code}: the save did not land. The tab's last PUTs: ${puts.join(' | ')}`,
							{ cause: error }
						);
					}
					const full = await readDoc(code);
					expect(full, `${key} → ${code}`).toMatchObject({
						status: 'Completed',
						unanswered_count: 0
					});
					expect(
						Number(full!.pass_count) + Number(full!.fail_count) + Number(full!.pending_count)
					).toBe(total);
					expect(Number(full!.fail_count), `${code} has a Fail`).toBeGreaterThan(0);
					expect(JSON.stringify(full!.controls)).toContain(MARKER);
				}
			});
		}

		// ── Past date ───────────────────────────────────────────────────────────
		test('a past date is read-only for every account', async ({ browser }) => {
			test.setTimeout(240_000);
			for (const account of accounts) {
				const page = await pageFor(browser, account);
				const [role] = assessableCodes(account);
				if (!role) {
					await openDenied(page, 'SM', YESTERDAY);
					continue;
				}
				await openRole(page, role, YESTERDAY);
				await expectReadOnly(page);
			}
		});

		test('the VDU refuses to create a past-day document, for owner, SM and SA', async () => {
			const source = await readDoc('REG');
			expect(source).not.toBeNull();
			const { _rev: _unused, ...rest } = source as CouchDocument;
			void _unused;
			const pastId = docId('REG', YESTERDAY);
			for (const account of [ownerOf('REG'), ownerOf('SM'), accountByKey('sa')]) {
				const res = await couchAs(account.session, 'PUT', pastId, {
					...rest,
					_id: pastId,
					assessment_date: YESTERDAY,
					created_by: account.user.name
				});
				expect(res.status, `${account.key} past-day create`).toBe(403);
				expect(res.reason).toMatch(/current Bangkok date/);
			}
		});

		// ── Notes: optional for Fail, required for Pending ────────────────────
		test('Fail saves without a note; Pending without a note is refused (VDU)', async ({
			browser
		}) => {
			test.setTimeout(120_000);
			const owner = ownerOf('REG');
			const page = await pageFor(browser, owner);
			await openRole(page, 'REG');
			const questions = questionsForRole('REG');
			const passIndex = (
				(await readDoc('REG'))!.controls as Array<{ id: string; status: string }>
			).findIndex((c) => c.status === 'Pass');
			expect(passIndex, 'REG has a Pass answer to flip').toBeGreaterThanOrEqual(0);
			const questionId = questions[passIndex].id;

			await choose(page, questionId, 'Fail');
			// A Pass may carry an old note: clear it, so this Fail has none.
			await note(page, questionId, '');
			await saveAndConfirm(page);
			await expect
				.poll(
					async () =>
						((await readDoc('REG'))!.controls as Array<Record<string, unknown>>).find(
							(c) => c.id === questionId
						),
					{ timeout: 20_000 }
				)
				.toMatchObject({ status: 'Fail', notes: '' });

			// The VDU refuses a Pending without a note when it is sent without the UI.
			const read = await couchAs(owner.session, 'GET', docId('REG'));
			const controls = (read.data.controls as Array<Record<string, unknown>>).map((c) =>
				c.id === questionId ? { ...c, status: 'Pending', notes: '' } : c
			);
			const res = await couchAs(owner.session, 'PUT', docId('REG'), { ...read.data, controls });
			expect(res.status, 'Pending without a note').toBe(403);
		});

		// ── Metric questions ────────────────────────────────────────────────────
		test('metric questions offer Pass/Fail with SOP parameters, else only "Pending" with a note', async ({
			browser
		}) => {
			test.setTimeout(120_000);
			const page = await pageFor(browser, ownerOf('FAC'));
			await openRole(page, 'FAC');
			const parameterQuestion = questionsForRole('FAC')[0].id; // D-FAC-01 uses m2_per_person_living
			const passEnabled = await radio(page, parameterQuestion, 'Pass').isEnabled();
			if (passEnabled) {
				await expect(radio(page, parameterQuestion, 'Fail')).toBeEnabled();
				await expect(radio(page, parameterQuestion, 'Pending')).toHaveCount(0);
				return;
			}
			await expect(radio(page, parameterQuestion, 'Fail')).toBeDisabled();
			await expect(radio(page, parameterQuestion, 'Pending')).toBeEnabled();
			// Pending needs a note: Save stays clickable, but nothing is written and the note gets focus.
			const before = await readDoc('FAC');
			await choose(page, parameterQuestion, 'Pending');
			await note(page, parameterQuestion, '');
			await saveButton(page).click();
			await expect(page.locator(`#daily-sop-${parameterQuestion}-notes`)).toBeFocused();
			expect((await readDoc('FAC'))!._rev, 'nothing was written while blocked').toBe(before!._rev);
		});

		// ── Zero-leak ───────────────────────────────────────────────────────────
		test('Z: teardown leaves no E2E shelter database or account behind', async () => {
			test.setTimeout(240_000);
			await closePages();
			const code = shelterCode!;
			await teardownShelter(code);
			for (const account of accounts) await deleteCouchUser(account.user.name);
			shelterCode = undefined;

			expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
			for (const account of accounts) {
				const user = await couchReq(
					'GET',
					`/_users/org.couchdb.user:${encodeURIComponent(account.user.name)}`
				);
				expect(user.status, `${account.user.name} removed`).toBe(404);
			}
		});
	}
);
