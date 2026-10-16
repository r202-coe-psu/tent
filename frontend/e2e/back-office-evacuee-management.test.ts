/**
 * J5 — Back office evacuee management (`/back-office/evacuee-management`).
 *
 * Live `@release` on an own `E2E` shelter (not SH001): staff creates the shelter,
 * registers one household at Station 1, then proves the critical path on the
 * evacuee + household tabs (list → search → open detail / edit).
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
	createShelterViaUi,
	registerHouseholdViaUi,
	selectActiveShelter
} from './helpers/staff-ui';

test.describe.configure({ mode: 'serial' });

const SHELTER_NAME = `E2E ศูนย์ทดสอบ J5 ${RUN_ID}`;
const LAST_NAME = `จ5${RUN_ID}`;
const HEAD_FIRST = `หัวหน้าจ5${RUN_ID}`;
const MEMBER_FIRST = `สมาชิกจ5${RUN_ID}`;
const HEAD_FULL = `${HEAD_FIRST} ${LAST_NAME}`;
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
			recordCreatedShelter(shelterCode);
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
			await expect(page.getByRole('button', { name: 'รายชื่อผู้ประสบภัย' })).toBeVisible();
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
