/**
 * Shelter Incident Log (CR-155) — `/back-office/incidents` on an own `E2E` shelter.
 *
 * Real roles, all scoped to the run's shelter (compound `{code}:{cap}` roles):
 *   - owner   (registration_staff) — opens a record and becomes its owner
 *   - peer    (kitchen_staff)      — any staff: may add notes, not change status
 *   - manager (shelter_manager)    — may cancel
 *   - outsider (staff of SH001)    — refused (read-only role; nothing is written to SH001)
 *
 * Proves: create form validation, create → detail, notes by non-owners, status graph,
 * late-binding of the respondent, handover (D2), owner close (D3), manager cancel (D4),
 * list filter/search, no delete for any role (VDU), and the route guard.
 *
 * Teardown: ledger (`recordCreatedShelter`) + `teardownShelter` + Couch user delete;
 * the Z test asserts the shelter DB, registry row and users are gone.
 *
 * Tags: `@incidents` + `@critical`. Local: `docker compose up -d`, `pnpm seed:master`, then
 *   pnpm exec playwright test e2e/incidents.test.ts
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
	type TestUser
} from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { openAsShelterStaff } from './helpers/onsite';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

test.describe.configure({ mode: 'serial' });
test.use({ actionTimeout: 15_000 });

const SHELTER_NAME = `E2E Incident ${RUN_ID}`;
const MAIN_TITLE = `E2E ทะเลาะหน้าโรงอาหาร ${RUN_ID}`;
const SECOND_TITLE = `E2E แจ้งเหตุซ้ำ ${RUN_ID}`;
const RESPONDENT_NAME = `E2E บุคคลภายนอก ${RUN_ID}`;

type Role = 'owner' | 'peer' | 'manager' | 'outsider';

let shelterCode: string | undefined;
let mainId: string | undefined;
let secondId: string | undefined;
let liveWritesStarted = false;
const users = new Map<Role, TestUser>();
const sessions = new Map<Role, string>();

function staff(role: Role, code: string, cap: string, display: string): TestUser {
	return {
		name: `incident_${role}_${RUN_ID}`,
		password: 'Password1!',
		roles: [`shelter:${code}`, `${code}:${cap}`],
		display_name: display
	};
}

async function ensureStaff(code: string): Promise<void> {
	if (sessions.size === 4) return;
	users.set('owner', staff('owner', code, 'registration_staff', `E2E Owner ${RUN_ID}`));
	users.set('peer', staff('peer', code, 'kitchen_staff', `E2E Peer ${RUN_ID}`));
	users.set('manager', staff('manager', code, 'shelter_manager', `E2E Manager ${RUN_ID}`));
	users.set('outsider', staff('outsider', 'SH001', 'registration_staff', `E2E Out ${RUN_ID}`));
	for (const [role, user] of users) {
		await createCouchUser(user);
		await seedSecurityQuestion(user.name);
		sessions.set(role, await couchLogin(user.name, user.password));
	}
}

async function openAs(browser: Browser, role: Role): Promise<Page> {
	return openAsShelterStaff(browser, users.get(role)!, sessions.get(role)!, shelterCode!);
}

const shelterDb = () => `shelter_${shelterCode!.toLowerCase()}`;

async function readIncident(id: string) {
	const doc = await getDocument(shelterDb(), id);
	expect(doc, `${id} should exist`).not.toBeNull();
	return doc as Record<string, unknown> & {
		assigned_to: string;
		current_status: string;
		respondent: { status: string; name_or_detail: string | null };
		timeline: Array<{ type: string; actor_id: string; details: string; to_status?: string }>;
	};
}

async function openDetail(page: Page, id: string): Promise<void> {
	await page.goto(`/back-office/incidents/${encodeURIComponent(id)}`);
	await expect(page.getByText('ไทม์ไลน์', { exact: true })).toBeVisible({
		timeout: 30_000
	});
}

async function pickOption(page: Page, label: string, option: string): Promise<void> {
	await page.getByLabel(label).click();
	await page.getByRole('option', { name: option, exact: true }).click();
}

/** Open an action from the detail page, write the reason, confirm, and wait for the toast. */
async function runAction(
	page: Page,
	button: string,
	note: string,
	fill?: (dialog: ReturnType<Page['getByRole']>) => Promise<void>
): Promise<void> {
	await page.getByRole('button', { name: button, exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog).toBeVisible();
	if (fill) await fill(dialog);
	await dialog.locator('#incident-action-note').fill(note);
	await dialog.getByRole('button', { name: 'ยืนยัน' }).click();
	await expect(page.getByText('บันทึกลงไทม์ไลน์แล้ว').first()).toBeVisible();
	await expect(dialog).toBeHidden();
}

async function createIncidentViaUi(page: Page, title: string): Promise<string> {
	await page.goto('/back-office/incidents/new');
	await expect(page.getByRole('heading', { name: 'บันทึกเหตุการณ์ใหม่' })).toBeVisible({
		timeout: 30_000
	});
	await page.getByLabel('หัวข้อเหตุการณ์').fill(title);
	await pickOption(page, 'หมวดหมู่', 'ข้อพิพาททั่วไป');
	await pickOption(page, 'ระดับความรุนแรง', 'สูง');
	await page.getByLabel('จุดเกิดเหตุ').fill('หน้าโรงอาหาร E2E');
	await page.getByLabel('รายละเอียดตามข้อเท็จจริง').fill('ทะเลาะกันเรื่องคิวรับอาหาร');
	await pickOption(page, 'ประเภท', 'ไม่ประสงค์ออกนาม');
	await page.getByLabel('รูปพรรณสัณฐาน').fill('ชายเสื้อแดง สูงประมาณ 170 ซม.');
	await page.getByRole('button', { name: 'บันทึกเหตุการณ์' }).click();

	await expect(page).toHaveURL(/\/back-office\/incidents\/shelter_incident/, { timeout: 30_000 });
	await expect(page.getByText(/คุณเป็นผู้รับผิดชอบเคสนี้/).first()).toBeVisible();
	return decodeURIComponent(new URL(page.url()).pathname.split('/').pop()!);
}

test.afterAll(async () => {
	test.setTimeout(180_000);
	if (!CAN_WRITE || !liveWritesStarted) return;
	if (shelterCode) {
		await teardownShelter(shelterCode).catch(() => undefined);
		shelterCode = undefined;
	}
	for (const user of users.values()) await deleteCouchUser(user.name).catch(() => undefined);
});

test.describe(
	'Shelter Incident Log (own E2E shelter)',
	{ tag: ['@incidents', '@critical'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('provision E2E shelter and shelter staff', async ({ page }) => {
			test.setTimeout(180_000);
			liveWritesStarted = true;
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			shelterCode = await createShelterViaUi(page, {
				name: SHELTER_NAME,
				siteKind: 'evacuation_center',
				lat: 7.006,
				lng: 100.501,
				subdistrict: 'คอหงส์',
				capacity: 40
			});
			recordCreatedShelter(shelterCode);
			await ensureStaff(shelterCode);
		});

		test('create form refuses an empty title and writes nothing', async ({ browser }) => {
			const page = await openAs(browser, 'owner');
			await page.goto('/back-office/incidents/new');
			await expect(page.getByRole('heading', { name: 'บันทึกเหตุการณ์ใหม่' })).toBeVisible({
				timeout: 30_000
			});
			await page.getByRole('button', { name: 'บันทึกเหตุการณ์' }).click();

			await expect(page.getByText('กรุณาตรวจสอบข้อมูลในฟอร์ม').first()).toBeVisible();
			await expect(page.getByText('กรุณาระบุหัวข้อเหตุการณ์')).toBeVisible();
			await expect(page).toHaveURL(/\/back-office\/incidents\/new$/);
			const all = await couchReq(
				'GET',
				`/${shelterDb()}/_all_docs?startkey="shelter_incident:"&endkey="shelter_incident:￰"`
			);
			expect((all.data as { rows: unknown[] }).rows).toEqual([]);
			await page.context().close();
		});

		test('any staff opens a record and becomes its owner', async ({ browser }) => {
			const page = await openAs(browser, 'owner');
			mainId = await createIncidentViaUi(page, MAIN_TITLE);

			await expect(page.getByText(MAIN_TITLE).first()).toBeVisible();
			await expect(page.getByText('(คุณ)')).toBeVisible();
			// D4 — only managers see cancel; the owner does not.
			await expect(page.getByRole('button', { name: 'ยกเลิกเคส' })).toHaveCount(0);

			const doc = await readIncident(mainId);
			const owner = users.get('owner')!.name;
			expect(doc).toMatchObject({
				type: 'shelter_incident',
				title: MAIN_TITLE,
				category: 'dispute',
				severity: 'high',
				current_status: 'reported',
				reported_by: owner,
				assigned_to: owner,
				shelter_code: shelterCode,
				complainant: { type: 'anonymous' },
				respondent: { status: 'unknown' }
			});
			expect(doc.incident_no).toMatch(/^INC-\d{8}-\d{3}$/);
			expect(doc.timeline).toEqual([]);
			await page.context().close();
		});

		test('a non-owner adds a note but cannot change status', async ({ browser }) => {
			const page = await openAs(browser, 'peer');
			await openDetail(page, mainId!);

			await expect(page.getByRole('button', { name: 'เริ่ม / กลับมาดำเนินการ' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'ส่งต่อเคส' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'ระบุคู่กรณี' })).toHaveCount(0);
			await expect(page.getByText(/คุณเพิ่มบันทึกเบาะแสได้/)).toBeVisible();

			await runAction(page, 'เพิ่มบันทึกสังเกตการณ์', 'เห็นเหตุการณ์จากโซนครัว');
			await expect(page.getByText('เห็นเหตุการณ์จากโซนครัว')).toBeVisible();

			const doc = await readIncident(mainId!);
			expect(doc.current_status).toBe('reported');
			expect(doc.timeline.at(-1)).toMatchObject({
				type: 'add_note',
				actor_id: users.get('peer')!.name,
				details: 'เห็นเหตุการณ์จากโซนครัว'
			});
			await page.context().close();
		});

		test('the owner works the case, identifies the respondent and hands it over', async ({
			browser
		}) => {
			const page = await openAs(browser, 'owner');
			await openDetail(page, mainId!);

			await runAction(page, 'เริ่ม / กลับมาดำเนินการ', 'เข้าไกล่เกลี่ยแล้ว');
			await expect(page.getByText('กำลังดำเนินการ').first()).toBeVisible();

			await runAction(page, 'ระบุคู่กรณี', 'ตรวจจากกล้องวงจรปิด', async (dialog) => {
				await dialog.getByRole('button', { name: 'ผู้เข้าพัก (ทราบตัวตน)' }).click();
				await page.getByRole('option', { name: 'บุคคลภายนอก (ทราบตัวตน)' }).click();
				await dialog.locator('#identify-name').fill(RESPONDENT_NAME);
			});
			await expect(page.getByText(RESPONDENT_NAME)).toBeVisible();
			await expect(page.getByRole('button', { name: 'ระบุคู่กรณี' })).toHaveCount(0);

			const peer = users.get('peer')!;
			await runAction(page, 'ส่งต่อเคส', 'ส่งเวรให้ฝ่ายครัวติดตาม', async (dialog) => {
				await dialog.locator('[data-name="assigned_to"]').click();
				await page.getByPlaceholder('พิมพ์ชื่อหรือ username เพื่อค้นหา...').fill(peer.name);
				await page.getByRole('button', { name: `${peer.display_name} (${peer.name})` }).click();
			});
			// Ownership moved — the former owner may only add notes now.
			await expect(page.getByRole('button', { name: 'จัดการเรียบร้อย' })).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'ส่งต่อเคส' })).toHaveCount(0);

			const doc = await readIncident(mainId!);
			expect(doc.assigned_to).toBe(peer.name);
			expect(doc.current_status).toBe('action_in_progress');
			expect(doc.respondent).toMatchObject({
				status: 'known_external',
				name_or_detail: RESPONDENT_NAME
			});
			expect(doc.timeline.map((t) => t.type)).toEqual([
				'add_note',
				'status_change',
				'identify_respondent',
				'reassignment'
			]);
			await page.context().close();
		});

		test('the new owner resolves and closes the case (D3)', async ({ browser }) => {
			const page = await openAs(browser, 'peer');
			await openDetail(page, mainId!);

			await runAction(page, 'จัดการเรียบร้อย', 'ทั้งสองฝ่ายตกลงกันได้');
			await runAction(page, 'ปิดเคส', 'ปิดเคสหลังติดตามผล 1 วัน');
			await expect(page.getByText('เคสนี้ปิดเคสแล้ว — แก้ไขเพิ่มเติมไม่ได้')).toBeVisible();
			await expect(page.getByRole('button', { name: 'เพิ่มบันทึกสังเกตการณ์' })).toHaveCount(0);

			const doc = await readIncident(mainId!);
			expect(doc.current_status).toBe('closed');
			expect(doc.timeline.at(-1)).toMatchObject({
				type: 'status_change',
				actor_id: users.get('peer')!.name,
				to_status: 'closed'
			});
			await page.context().close();
		});

		test('only the manager cancels a case (D4)', async ({ browser }) => {
			const ownerPage = await openAs(browser, 'owner');
			secondId = await createIncidentViaUi(ownerPage, SECOND_TITLE);
			await ownerPage.context().close();

			const page = await openAs(browser, 'manager');
			await openDetail(page, secondId);
			await runAction(page, 'ยกเลิกเคส', 'แจ้งซ้ำกับเคสเดิม');
			await expect(page.getByText('เคสนี้ยกเลิกแล้ว — แก้ไขเพิ่มเติมไม่ได้')).toBeVisible();

			const doc = await readIncident(secondId);
			expect(doc.current_status).toBe('cancelled');
			expect(doc.timeline.at(-1)).toMatchObject({
				actor_id: users.get('manager')!.name,
				to_status: 'cancelled'
			});
			await page.context().close();
		});

		test('the list hides finished cases by default and finds them by search', async ({
			browser
		}) => {
			const page = await openAs(browser, 'owner');
			await page.goto('/back-office/incidents');
			await expect(
				page.getByRole('heading', { level: 2, name: 'บันทึกเหตุการณ์ประจำวัน' })
			).toBeVisible({
				timeout: 30_000
			});

			await page.getByRole('searchbox', { name: 'ค้นหาบันทึกเหตุการณ์' }).fill(RUN_ID);
			await expect(page.getByText(`ไม่พบบันทึกเหตุการณ์ที่ตรงกับ "${RUN_ID}"`)).toBeVisible();

			await page.getByRole('button', { name: 'ยังไม่ปิด (ส่งเวร)' }).click();
			await page.getByRole('option', { name: 'ทุกสถานะ' }).click();
			const table = page.locator('table');
			await expect(table.getByRole('link', { name: MAIN_TITLE })).toBeVisible();
			await expect(table.getByRole('link', { name: SECOND_TITLE })).toBeVisible();

			await table.getByRole('link', { name: MAIN_TITLE }).click();
			await expect(page).toHaveURL(new RegExp(encodeURIComponent(mainId!)));
			await page.context().close();
		});

		test('no role may delete a record (VDU)', async () => {
			const doc = await readIncident(secondId!);
			for (const role of ['owner', 'manager'] as const) {
				const res = await fetch(
					`${COUCH_BASE}/${shelterDb()}/${encodeURIComponent(secondId!)}?rev=${doc._rev}`,
					{ method: 'DELETE', headers: { Cookie: `AuthSession=${sessions.get(role)}` } }
				);
				expect(res.status, role).toBe(403);
				expect(await res.json()).toMatchObject({
					reason: 'Cannot delete shelter_incident documents'
				});
			}
			expect(await getDocument(shelterDb(), secondId!)).not.toBeNull();
		});

		test('staff of another shelter are turned away', async ({ browser }) => {
			const page = await openAs(browser, 'outsider');
			await page.goto('/back-office/incidents');
			await expect(page).toHaveURL(/\/portal/, { timeout: 30_000 });
			await page.context().close();
		});

		test('Z teardown leaves no E2E shelter or staff of this run', async () => {
			test.setTimeout(180_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;
			await teardownShelter(code);
			shelterCode = undefined;
			for (const user of users.values()) await deleteCouchUser(user.name);

			expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
			const byCode = await couchReq(
				'GET',
				`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
			);
			expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
			for (const user of users.values()) {
				const got = await couchReq('GET', `/_users/org.couchdb.user:${user.name}`);
				expect(got.status, user.name).toBe(404);
			}
		});
	}
);
