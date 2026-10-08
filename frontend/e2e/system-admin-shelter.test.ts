/**
 * J6 — System admin shelter create / edit (`/system-management/shelters`).
 *
 * Live `@release`: SA creates an `E2E …` shelter, edits capacity, asserts the
 * registry list and the public BFF projection, then tears down with
 * `teardownShelter` (zero-leak).
 *
 * Tags: `@system-admin` + `@critical` + `@release`. Skips when `IS_REMOTE`.
 * Local stack: `docker compose up -d` + `pnpm seed:master` / `pnpm db:sync`.
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { IS_REMOTE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	publicShelter,
	recordCreatedShelter,
	teardownShelter,
	waitForProjection
} from './helpers/public-cleanup';
import { createShelterViaUi } from './helpers/staff-ui';

test.describe.configure({ mode: 'serial' });

const SHELTER_NAME = `E2E ศูนย์ทดสอบ J6 ${RUN_ID}`;
const CREATE_CAPACITY = 55;
const EDITED_CAPACITY = 77;

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) {
		await teardownShelter(shelterCode);
		shelterCode = undefined;
	}
});

test.describe(
	'J6 System admin shelter create and edit',
	{ tag: ['@system-admin', '@critical', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(IS_REMOTE, READ_ONLY_REASON);
		});

		test('SA creates a shelter via system-management', async ({ page }) => {
			test.setTimeout(120_000);
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);

			shelterCode = await createShelterViaUi(page, {
				name: SHELTER_NAME,
				siteKind: 'evacuation_center',
				lat: 7.008,
				lng: 100.503,
				subdistrict: 'คอหงส์',
				capacity: CREATE_CAPACITY
			});
			recordCreatedShelter(shelterCode);
			await expect(page).toHaveURL(new RegExp(`/system-management/shelters/edit/${shelterCode}$`));
		});

		test('SA edits capacity and sees the shelter in the registry', async ({ page }) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);

			await page.goto(`/system-management/shelters/edit/${code}`);
			const capacity = page.getByRole('spinbutton', { name: 'ความจุสูงสุด (Max Capacity) *' });
			await expect(capacity).toBeVisible({ timeout: 30_000 });
			await capacity.fill(String(EDITED_CAPACITY));
			await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();
			await expect(page.getByText(`อัปเดตข้อมูลศูนย์พักพิง ${code} สำเร็จ`)).toBeVisible({
				timeout: 30_000
			});

			await page.goto('/system-management/shelters');
			await expect(
				page.getByRole('heading', { name: 'จัดการศูนย์พักพิงและบ้านพี่เลี้ยง' })
			).toBeVisible();
			await page.getByPlaceholder('ค้นหาชื่อ, รหัส, จังหวัด, อำเภอ...').fill(code);
			await expect(page.getByText(code).first()).toBeVisible({ timeout: 15_000 });
			await expect(page.getByText(SHELTER_NAME).first()).toBeVisible();
			await expect(page.getByText(String(EDITED_CAPACITY)).first()).toBeVisible();
		});

		test('public projection shows the edited shelter', async () => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;

			await waitForProjection(
				`${code} capacity ${EDITED_CAPACITY}`,
				async () => {
					const row = await publicShelter(code);
					return row?.status === 'open' && row.capacity === EDITED_CAPACITY;
				},
				{ timeoutMs: 90_000, intervalMs: 3_000 }
			);

			const row = await publicShelter(code);
			expect(row?.name).toBe(SHELTER_NAME);
			expect(row?.capacity).toBe(EDITED_CAPACITY);
			expect(row?.status).toBe('open');
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
			// Public list may keep a closed row briefly after master delete; never "open".
			const row = await publicShelter(code);
			expect(row?.status === 'open').toBeFalsy();
		});
	}
);
