/**
 * CR-252 — System admin creates and edits an External shelter
 * (`/system-management/shelters`), UI-driven against the real local stack.
 *
 * The external form keeps only basic info: URL + the optional Max Capacity. Regression: an
 * external shelter saved without a capacity used to come back as `capacity: 0` on the next
 * load and then failed validation ("ความจุสูงสุดต้องมากกว่า 0") on every re-save.
 *
 * Tags: `@system-admin` + `@release`. Needs `docker compose up -d` + `pnpm seed:master`.
 */
import { test, expect } from '@playwright/test';
import { bootstrapAdminSession, couchReq } from './helpers/couch';
import { CAN_WRITE, LOCAL_RUN_ID as RUN_ID, READ_ONLY_REASON } from './helpers/e2e-env';
import { injectSession, routeBrowserCouchThroughApp } from './helpers/login';
import {
	publicShelter,
	recordCreatedShelter,
	teardownShelter,
	waitForProjection
} from './helpers/public-cleanup';

const LEDGER_SUITE = 'system-admin-external-shelter';

test.describe.configure({ mode: 'serial' });

const SHELTER_NAME = `E2E ศูนย์ภายนอก ${RUN_ID}`;
const EXTERNAL_URL = 'https://example.org/shelter/e2e';
const EDITED_CAPACITY = 120;

let shelterCode: string | undefined;

test.afterAll(async () => {
	test.setTimeout(120_000);
	if (shelterCode) {
		await teardownShelter(shelterCode);
		shelterCode = undefined;
	}
});

async function registryDoc(code: string): Promise<Record<string, unknown>> {
	const res = await couchReq(
		'GET',
		`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}&include_docs=true`
	);
	const doc = (res.data as { rows?: { doc?: Record<string, unknown> }[] }).rows?.[0]?.doc;
	expect(doc, `registry doc for ${code}`).toBeTruthy();
	return doc!;
}

test.describe(
	'CR-252 External shelter create and edit',
	{ tag: ['@system-admin', '@release'] },
	() => {
		test.beforeEach(() => {
			test.skip(!CAN_WRITE, READ_ONLY_REASON);
		});

		test('SA creates an external shelter with no capacity', async ({ page }) => {
			test.setTimeout(120_000);
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);

			await page.goto('/system-management/shelters/create');
			await page.getByRole('switch', { name: 'ศูนย์จากระบบภายนอก (External)' }).click();
			// Basic info only: no capacity section / zones, but the optional Max Capacity input stays.
			await expect(
				page.getByRole('spinbutton', { name: 'ความจุสูงสุด (Max Capacity)' })
			).toBeVisible();
			await expect(page.getByText('ข้อมูลความจุเชิงพื้นที่')).toHaveCount(0);
			await expect(page.getByRole('button', { name: 'ประเภทอาคาร' })).toBeVisible();

			await page.getByRole('textbox', { name: 'ชื่อศูนย์พักพิง *' }).fill(SHELTER_NAME);
			await page.getByRole('textbox', { name: /ลิงก์ไปยังระบบต้นทาง/ }).fill(EXTERNAL_URL);
			await page.getByRole('button', { name: 'ชนิดสถานที่ *' }).click();
			await page.getByRole('option', { name: 'ศูนย์อพยพ', exact: true }).click();
			await page.getByRole('spinbutton', { name: 'ละติจูด (Latitude)' }).fill('7.008');
			await page.getByRole('spinbutton', { name: 'ลองจิจูด (Longitude)' }).fill('100.503');
			await page.getByRole('button', { name: 'เลือกจังหวัด...' }).click();
			await page.getByRole('button', { name: 'สงขลา' }).click();
			await page.getByRole('button', { name: 'เลือกอำเภอ...' }).click();
			await page.getByRole('button', { name: 'หาดใหญ่' }).click();
			await page.getByRole('button', { name: 'เลือกตำบล' }).click();
			await page.getByRole('button', { name: 'คอหงส์' }).click();
			await page.getByRole('button', { name: 'บันทึกข้อมูล' }).click();

			await expect(page).toHaveURL(/\/system-management\/shelters\/edit\/SH\d+$/, {
				timeout: 30_000
			});
			shelterCode = new URL(page.url()).pathname.split('/').pop()!;
			recordCreatedShelter(shelterCode, LEDGER_SUITE);

			const doc = await registryDoc(shelterCode);
			expect(doc.is_external).toBe(true);
			expect(doc.operation_status).toBe('unknown');
			expect(doc.external_url).toBe(EXTERNAL_URL);
			expect(doc.capacity ?? null).toBeNull();
		});

		test('SA re-saves without capacity, then sets it', async ({ page }) => {
			test.setTimeout(120_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;
			const admin = await bootstrapAdminSession();
			await routeBrowserCouchThroughApp(page);
			await injectSession(page, admin.user, admin.cookie);

			const capacity = page.getByRole('spinbutton', { name: 'ความจุสูงสุด (Max Capacity)' });
			const save = page.getByRole('button', { name: 'บันทึกข้อมูล' });
			const saved = page.getByText(`อัปเดตข้อมูลศูนย์พักพิง ${code} สำเร็จ`);

			// 1. The bug: reopen an external shelter that has no capacity and save untouched.
			await page.goto(`/system-management/shelters/edit/${code}`);
			await expect(capacity).toBeVisible({ timeout: 30_000 });
			await expect(capacity).toHaveValue('');
			await save.click();
			await expect(saved).toBeVisible({ timeout: 30_000 });

			// 2. Set a capacity.
			await page.goto(`/system-management/shelters/edit/${code}`);
			await expect(capacity).toBeVisible({ timeout: 30_000 });
			await capacity.fill(String(EDITED_CAPACITY));
			await save.click();
			await expect(saved).toBeVisible({ timeout: 30_000 });
			expect((await registryDoc(code)).capacity).toBe(EDITED_CAPACITY);

			// 3. Reload shows it; saving again keeps the stored value (a blank input = "no change").
			await page.goto(`/system-management/shelters/edit/${code}`);
			await expect(capacity).toHaveValue(String(EDITED_CAPACITY), { timeout: 30_000 });
			await save.click();
			await expect(saved).toBeVisible({ timeout: 30_000 });

			const doc = await registryDoc(code);
			expect(doc.is_external).toBe(true);
			expect(doc.operation_status).toBe('unknown');
			expect(doc.capacity).toBe(EDITED_CAPACITY);
		});

		test('public projection shows the external shelter with its max capacity', async ({ page }) => {
			test.setTimeout(120_000);
			const code = shelterCode!;
			await waitForProjection(
				`${code} unknown capacity ${EDITED_CAPACITY}`,
				async () => {
					const row = (await publicShelter(code)) as
						{ status?: string; capacity?: number; is_external?: boolean } | undefined;
					return row?.status === 'unknown' && row.capacity === EDITED_CAPACITY;
				},
				{ timeoutMs: 90_000, intervalMs: 3_000 }
			);
			const row = (await publicShelter(code)) as { is_external?: boolean; external_url?: string };
			expect(row.is_external).toBe(true);
			expect(row.external_url).toBe(EXTERNAL_URL);

			// Detail page: capacity + contact only — no policy / facilities / Q&A sections.
			await page.goto(`/shelters/${code}`);
			await expect(page.getByText('ติดต่อสอบถาม')).toBeVisible({ timeout: 30_000 });
			await expect(page.getByText(String(EDITED_CAPACITY)).first()).toBeVisible();
			await expect(page.getByText('นโยบายการรับเข้าพัก')).toHaveCount(0);
			await expect(page.getByText('สิ่งอำนวยความสะดวกในศูนย์')).toHaveCount(0);
			await expect(page.getByText('Q:')).toHaveCount(0);
		});

		test('Z teardown leaves no E2E shelter from this run', async () => {
			test.setTimeout(180_000);
			expect(shelterCode).toBeTruthy();
			const code = shelterCode!;
			await teardownShelter(code);
			shelterCode = undefined;
			expect((await couchReq('GET', `/shelter_${code.toLowerCase()}`)).status).toBe(404);
		});
	}
);
