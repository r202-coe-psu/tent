/**
 * J5 — Back office evacuee management (`/back-office/evacuee-management`).
 *
 * Live `@release` on an own `E2E` shelter (not SH001): staff creates the shelter,
 * registers one household at Station 1, then proves the critical path on the
 * evacuee + household tabs (list → search → open detail / edit) and the
 * dashboard zone occupancy card.
 *
 * Tags: `@back-office` + `@critical` + `@release`. Runs locally or on a remote
 * target with `ALLOW_REMOTE_WRITES=true` (staging); read-only remote otherwise.
 * Local stack: `docker compose up -d` + `pnpm seed:master` / `pnpm db:sync`.
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { fictitiousNationalId, fictitiousPhone } from './helpers/pre-register';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import {
	configureOnsiteShelterViaUi,
	createShelterViaUi,
	registerHouseholdViaUi,
	selectActiveShelter
} from './helpers/staff-ui';

/** Id of this spec's created-data ledger (see helpers/public-cleanup.ts). */
const LEDGER_SUITE = 'back-office-evacuee-management';

test.describe.configure({ mode: 'serial' });

const SHELTER_NAME = `E2E ศูนย์ทดสอบ J5 ${RUN_ID}`;
const LAST_NAME = `จ5${RUN_ID}`;
const HEAD_FIRST = `หัวหน้าจ5${RUN_ID}`;
const MEMBER_FIRST = `สมาชิกจ5${RUN_ID}`;
const HEAD_FULL = `${HEAD_FIRST} ${LAST_NAME}`;
const ZONE_NAME = `โซนทดสอบ J5 ${RUN_ID}`;
const PHONE = fictitiousPhone(5);
const NATIONAL_ID = fictitiousNationalId(Number(String(Date.now()).slice(-11)));

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) {
		await teardownShelter(shelterCode);
		shelterCode = undefined;
	}
});

test.describe(
	'J5 Back office evacuee management',
	{ tag: ['@back-office', '@critical', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('staff creates an E2E shelter and registers one household', async ({ page }) => {
			test.setTimeout(180_000);
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
			recordCreatedShelter(shelterCode, LEDGER_SUITE);
			await selectActiveShelter(page, shelterCode);
			await registerHouseholdViaUi(page, {
				houseNo: 'จ5/1',
				members: [
					{
						firstName: HEAD_FIRST,
						lastName: LAST_NAME,
						gender: 'ชาย',
						phone: PHONE,
						idCard: { type: 'national_id', number: NATIONAL_ID }
					},
					{ firstName: MEMBER_FIRST, lastName: LAST_NAME, gender: 'หญิง' }
				]
			});
		});

		test('evacuee tab lists, searches, and opens detail', async ({ page }) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);

			await page.goto('/back-office/evacuee-management?tab=evacuee');
			await expect(page.getByRole('button', { name: 'รายชื่อผู้เข้าพัก' })).toBeVisible();
			await expect(page.getByRole('heading', { name: 'ทะเบียนผู้พักพิง' })).toBeVisible({
				timeout: 30_000
			});

			// Desktop table + mobile cards both render the name; assert the visible table row.
			const evacueeRow = page.locator('table tbody tr').filter({ hasText: HEAD_FULL });
			await expect(async () => {
				await page.locator('#evacuee-search').fill(HEAD_FIRST);
				await expect(evacueeRow).toBeVisible({ timeout: 3_000 });
			}).toPass({ intervals: [2_000], timeout: 60_000 });

			await evacueeRow.getByRole('button', { name: 'แก้ไข' }).click();
			await expect(page).toHaveURL(/\/back-office\/evacuee-management\/edit\/evacuee\//);
			await expect(
				page.getByRole('heading', { name: 'ทะเบียนผู้พักพิง (Evacuee Registry)' })
			).toBeVisible();
			// Profile view renders name in mobile + desktop rails — assert a visible copy.
			await expect(page.getByText(HEAD_FIRST).filter({ visible: true }).first()).toBeVisible();
			await expect(page.getByText(LAST_NAME).filter({ visible: true }).first()).toBeVisible();
		});

		test('evacuee tab sorts newest first by default and via the sort dropdown (#1061)', async ({
			page
		}) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);

			await page.goto('/back-office/evacuee-management?tab=evacuee');
			await expect(page.getByRole('heading', { name: 'ทะเบียนผู้พักพิง' })).toBeVisible({
				timeout: 30_000
			});

			const rows = page.locator('table tbody tr');
			const sortTrigger = page.locator('#evacuee-sort');
			const firstNames = async () =>
				(await rows.allInnerTexts()).map((text) =>
					text.includes(MEMBER_FIRST) ? MEMBER_FIRST : text.includes(HEAD_FIRST) ? HEAD_FIRST : text
				);
			const pickSort = async (label: string) => {
				await sortTrigger.click();
				await page.getByRole('option', { name: label }).click();
				await expect(sortTrigger).toContainText(label);
			};

			// Head is registered before the member, so newest-first puts the member on top.
			await expect(sortTrigger).toContainText('ลงทะเบียนล่าสุดก่อน');
			await expect(rows).toHaveCount(2, { timeout: 60_000 });
			await expect.poll(firstNames).toEqual([MEMBER_FIRST, HEAD_FIRST]);

			// Unfiltered: server-paged `_all_docs` path.
			await pickSort('ลงทะเบียนเก่าสุดก่อน');
			await expect.poll(firstNames).toEqual([HEAD_FIRST, MEMBER_FIRST]);
			await pickSort('ชื่อ ก–ฮ');
			await expect.poll(firstNames).toEqual([MEMBER_FIRST, HEAD_FIRST]); // ส before ห

			// Search: client-paged path keeps the chosen order.
			await page.locator('#evacuee-search').fill(LAST_NAME);
			await pickSort('ลงทะเบียนเก่าสุดก่อน');
			await expect.poll(firstNames).toEqual([HEAD_FIRST, MEMBER_FIRST]);
			await pickSort('ลงทะเบียนล่าสุดก่อน');
			await expect.poll(firstNames).toEqual([MEMBER_FIRST, HEAD_FIRST]);
		});

		test('household tab lists the registered household and opens edit', async ({ page }) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);

			await page.goto('/back-office/evacuee-management?tab=household');
			await expect(page.getByRole('button', { name: 'รายชื่อครัวเรือน' })).toBeVisible();

			const householdRow = page.locator('table tbody tr').filter({ hasText: HEAD_FULL });
			await expect(async () => {
				await page.locator('#household-search').fill(HEAD_FIRST);
				await expect(householdRow).toBeVisible({ timeout: 3_000 });
			}).toPass({ intervals: [2_000], timeout: 60_000 });

			await householdRow.getByRole('button', { name: 'แก้ไข' }).click();
			await expect(page).toHaveURL(/\/back-office\/households\/edit\//);
			await expect(page.getByText(HEAD_FIRST).filter({ visible: true }).first()).toBeVisible({
				timeout: 30_000
			});
		});

		test('dashboard tab shows per-zone occupancy and the capacity gauge (CR-226)', async ({
			page
		}) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);

			const zoneCard = page
				.locator('div.rounded-xl')
				.filter({ has: page.getByRole('heading', { name: 'ความเต็มรายโซน' }) });

			await page.goto('/back-office/evacuee-management?tab=dashboard');
			await expect(zoneCard.getByText('ศูนย์นี้ยังไม่มีโซน')).toBeVisible({ timeout: 30_000 });
			await expect(page.getByRole('heading', { name: 'ภาพรวมความจุ' })).toHaveCount(0);

			await page.goto(`/system-management/shelters/edit/${shelterCode}`);
			await configureOnsiteShelterViaUi(page, shelterCode!, {
				zones: [{ name: ZONE_NAME, capacity: 20 }]
			});

			await page.goto('/back-office/evacuee-management?tab=dashboard');
			const zoneRow = zoneCard.getByRole('listitem').filter({ hasText: ZONE_NAME });
			await expect(zoneRow).toBeVisible({ timeout: 30_000 });
			await expect(zoneRow).toContainText('0 / 20 คน');
			await expect(zoneRow).toContainText('0%');

			await expect(page.getByRole('heading', { name: 'ภาพรวมความจุ' })).toBeVisible();
			await expect(page.getByRole('img', { name: 'ใช้ความจุไป 0% (0 จาก 20 คน)' })).toBeVisible();
		});

		test('Z teardown leaves no E2E shelter from this run', async () => {
			test.setTimeout(180_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;
			await teardownShelter(code);
			shelterCode = undefined;

			expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
			const byCode = await couchReq(
				'GET',
				`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
			);
			expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
		});
	}
);
