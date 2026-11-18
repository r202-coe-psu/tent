/**
 * Back office people import (`/back-office/households/import`) — Backfill Import (#1399).
 *
 * Live `@release` on an own `E2E` shelter with two zones: staff downloads the sample template,
 * uploads it back, imports the household, and sees the people in the evacuee registry. A second
 * case proves a pre-#1399 template (no สถานะ / เวลามา columns) is refused with a re-download hint.
 *
 * Runs locally or on a remote target with `ALLOW_REMOTE_WRITES=true`; read-only remote skips.
 */
import { test, expect } from '@playwright/test';
import ExcelJS from 'exceljs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { bootstrapAdminSession } from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import { recordCreatedShelter, teardownShelter } from './helpers/public-cleanup';
import {
	configureOnsiteShelterViaUi,
	createShelterViaUi,
	selectActiveShelter
} from './helpers/staff-ui';

const LEDGER_SUITE = 'back-office-people-import';
const IMPORT_PATH = '/back-office/households/import';

test.describe.configure({ mode: 'serial' });

const SHELTER_NAME = `E2E ศูนย์ทดสอบ นำเข้า ${RUN_ID}`;
// The sample template names the first active zone; both zones are open.
const ZONE_NAME = `โซนนำเข้า A ${RUN_ID}`;

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) {
		await teardownShelter(shelterCode);
		shelterCode = undefined;
	}
});

test.describe(
	'Back office people import (Backfill Import)',
	{ tag: ['@back-office', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('staff creates an E2E shelter with zones', async ({ page }) => {
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
			await configureOnsiteShelterViaUi(page, shelterCode, {
				zones: [
					{ name: ZONE_NAME, capacity: 20 },
					{ name: `โซนนำเข้า B ${RUN_ID}`, capacity: 20 }
				]
			});
		});

		test('sample template round-trips: upload, preview, import', async ({ page }) => {
			test.setTimeout(180_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);
			await page.goto(IMPORT_PATH);
			await expect(page.getByRole('heading', { name: 'นำเข้าผู้เข้าพักจาก Excel' })).toBeVisible();

			const [download] = await Promise.all([
				page.waitForEvent('download'),
				page.getByRole('button', { name: 'Template + ตัวอย่างข้อมูล' }).click()
			]);
			const file = path.join(tmpdir(), `people-import-${RUN_ID}.xlsx`);
			await download.saveAs(file);

			await page.locator('input[type="file"]').setInputFiles(file);
			// 1 household · 4 members (head + 4 people = 5) — the sample row uses an active zone.
			await expect(page.getByText(/พร้อมนำเข้า 1\D+ผิดพลาด\s*0/)).toBeVisible({ timeout: 30_000 });
			const importButton = page.getByRole('button', { name: /นำเข้า 1 ครัวเรือน \(4 คน\)/ });
			await expect(importButton).toBeEnabled({ timeout: 30_000 });
			await importButton.click();
			// The toast — not the button, whose label carries the same text before the import runs.
			await expect(
				page.locator('[data-sonner-toast]').getByText('นำเข้า 1 ครัวเรือน (5 คน)')
			).toBeVisible({ timeout: 60_000 });

			// The preview flags the blank-status sample member as waiting for Report-in (#1448).
			await expect(page.getByTestId('pending-report-in').first()).toContainText(
				'รอรายงานตัว (Station 1)'
			);
			await expect(page.getByText(/ใช้ template เก่า/)).toHaveCount(0);

			// Back-dated people landed in the registry: one active head, one already left, and the
			// blank-status member imported as pre_registered.
			await page.goto('/back-office/evacuee-management?tab=evacuee');
			const row = (name: string) => page.locator('table tbody tr').filter({ hasText: name });
			await expect(page.getByRole('heading', { name: 'ทะเบียนผู้พักพิง' })).toBeVisible({
				timeout: 30_000
			});
			for (const first of ['สมชาย', 'สมปอง', 'สมหมาย']) {
				await expect(async () => {
					await page.locator('#evacuee-search').fill(first);
					await expect(row(first)).toBeVisible({ timeout: 3_000 });
				}).toPass({ intervals: [2_000], timeout: 60_000 });
			}
			await expect(row('สมหมาย')).toContainText('ลงทะเบียนล่วงหน้า');
		});

		test('a template from before the stay columns is refused', async ({ page }) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);
			await selectActiveShelter(page, shelterCode!);
			await page.goto(IMPORT_PATH);

			const wb = new ExcelJS.Workbook();
			const ws = wb.addWorksheet('ครัวเรือน');
			ws.addRow(['ลำดับที่', 'ชื่อ', 'นามสกุล', 'เพศ']);
			ws.addRow([1, 'เก่า', 'ทดสอบ', 'ชาย']);
			const buffer = Buffer.from(await wb.xlsx.writeBuffer());

			await page.locator('input[type="file"]').setInputFiles({
				name: 'legacy.xlsx',
				mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
				buffer
			});
			await expect(page.getByText(/ใช้ template เก่า/)).toBeVisible({ timeout: 30_000 });
			await expect(page.getByRole('button', { name: /^นำเข้า / })).toBeDisabled();
		});
	}
);
