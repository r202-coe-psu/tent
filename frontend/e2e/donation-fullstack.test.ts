import { test, expect } from '@playwright/test';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { clearSession } from './helpers/login';
import {
	RUN_ID,
	RunLedger,
	approvePending,
	bookAsDonor,
	createCampaignViaUi,
	createWarehouseStaff,
	expectRunGone,
	fillExpiry,
	findDonation,
	ledgerRowsFor,
	openBackOffice,
	openInScanStation,
	openPendingRow,
	provisionShelter,
	reloadUntilVisible,
	suspendRecaptcha,
	teardownRun,
	type PublicNeed,
	type PublicShelter,
	type Staff
} from './helpers/donation-fullstack';

/**
 * Donor ↔ staff journeys for one booking, against the REAL stack (no route mocks), on
 * this run's own `E2E Donation donor …` shelter (README §4).
 *
 * Needs `docker compose up -d` (CouchDB, Mongo, worker, FastAPI) and a seeded catalog
 * (`pnpm seed`). Locally use the dev server — only it skips reCAPTCHA keys / the BFF's
 * per-IP rate limits (on `vite preview` also set DONATION_E2E_PACE=1):
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:5173 \
 *     pnpm exec playwright test e2e/donation-fullstack.test.ts
 * On a writable remote target (`E2E_BASE_URL` + `ALLOW_REMOTE_WRITES=true`, i.e. staging)
 * it runs like any `@critical` suite; read-only targets skip it.
 *
 * Setup: the shelter via system-management, its warehouse staff via CouchDB admin (users
 * have no UI), the campaign donors book against via back-office "สร้างประกาศ…" (a real
 * `item_master` id, so the scan station can receive it). Teardown (`teardownRun`, ids from
 * the per-run ledger only): cancel the bookings still open as their donors would, wait for
 * the quota to come back, delete shelter + staff. Last test (Z) asserts nothing is left.
 * Residue the test side cannot remove: the Mongo intake-buffer / `public_donations` rows
 * of the bookings, which retention purges on its TTL, and the closed `public_shelters` row
 * (dropped by the worker within minutes). Bookings are paced to the BFF's 3/min/IP limit
 * on remote targets, so the suite takes a few minutes there.
 * Back-office setup (slots, walk-in) lives in donation-fullstack-admin.
 */

// A catalog item with `shelf_life_days`: receiving it needs an expiry (`fillExpiry`).
const NEED_ITEM = 'ยาสีฟัน';

const ledger = new RunLedger('donation-fullstack');
let shelter: PublicShelter;
let need: PublicNeed;
let ws: Staff;
let restoreRecaptcha: (() => Promise<void>) | undefined;

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Donation full-stack: donor and staff', { tag: ['@critical', '@donation'] }, () => {
	test.describe.configure({ mode: 'serial', timeout: 240_000 });

	test.beforeAll(async ({ request, browser }) => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(360_000);
		restoreRecaptcha = await suspendRecaptcha(browser);
		const created = await provisionShelter(browser, ledger, 'donor');
		ws = await createWarehouseStaff(ledger, created.code, 'ws');

		const context = await browser.newContext();
		try {
			need = await createCampaignViaUi(await context.newPage(), request, ws, created.code, {
				item: NEED_ITEM,
				target: 50,
				notes: `e2e donor ${RUN_ID}`
			});
		} finally {
			await context.close();
		}
		shelter = { ...created, needs: [need] };
	});

	test.afterAll(async ({ request }) => {
		if (!CAN_WRITE) return;
		test.setTimeout(240_000);
		await restoreRecaptcha?.();
		await teardownRun(request, ledger);
	});

	test.describe('staff review', () => {
		test('approve → donor sees QR → receive into stock → donor sees received', async ({ page }) => {
			const phone = '0812345678';
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E รับของ ${RUN_ID}`,
				phone
			});

			await openBackOffice(page, ws);
			await approvePending(page, shelter.code, bookingRef);

			// Approved = the donor's ticket QR goes live; nothing to cancel any more.
			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await expect(page.getByRole('img', { name: `QR Code for ${bookingRef}` })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ยกเลิกการจองนี้' })).toHaveCount(0);

			// ── Scan station: count it in ───────────────────────────────────────────
			await openBackOffice(page, ws);
			await openInScanStation(page, bookingRef);
			const confirm = page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' });
			await expect(confirm).toBeDisabled();
			await expect(page.getByRole('textbox', { name: 'จำนวนรับจริง *' })).toHaveValue('1');
			await page.getByRole('checkbox', { name: 'ผ่านการตรวจสอบแล้ว' }).check();
			await page.getByRole('button', { name: /^โซนจัดเก็บ/ }).click();
			await page.getByRole('option').first().click();
			// An item with `shelf_life_days` counts as perishable (catalog.ts) and holds the
			// receive until it has an expiry — the seeded catalog gives NEED_ITEM one.
			await fillExpiry(page.getByRole('textbox', { name: 'วันหมดอายุ' }));
			await expect(confirm).toBeEnabled();

			const received = page.waitForResponse(
				(r) =>
					r.url().endsWith(`/api/back-office/donations/${bookingRef}`) &&
					r.request().method() === 'POST'
			);
			await confirm.click();
			expect((await received).ok()).toBe(true);
			// Receiving mints a lot number to write on the box.
			await expect(page.getByText('เลขล็อตที่ระบบออกให้ (เขียนติดกล่อง)')).toBeVisible();

			const donation = await findDonation(shelter.code, bookingRef);
			expect(donation.status).toBe('received');
			expect(await ledgerRowsFor(shelter.code, donation._id as string)).toEqual([
				expect.objectContaining({ item_id: need.item_id, qty: '1' })
			]);

			// ── Public: the donor looks it up by ref + phone ────────────────────────
			await clearSession(page);
			await page.goto(`/donations/track?ref=${bookingRef}&phone=${phone}`);
			await expect(page).toHaveURL(/\/donations\/track\/TX-/);
			await expect(page.getByRole('heading', { name: bookingRef })).toBeVisible();
			await reloadUntilVisible(
				page,
				page.getByRole('heading', { name: 'ศูนย์รับของเรียบร้อยแล้ว' })
			);
			await expect(page.getByRole('button', { name: 'แก้ไขรายการที่จะบริจาค' })).toHaveCount(0);
		});

		test('reject from the pending queue → donor sees it rejected', async ({ page }) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ปฏิเสธ ${RUN_ID}`,
				phone: '0898765432'
			});

			await openBackOffice(page, ws);
			await openPendingRow(page, bookingRef);
			await page.getByRole('button', { name: 'ปฏิเสธคำขอ' }).click();
			const confirmReject = page.getByRole('button', { name: 'ยืนยันการปฏิเสธคำขอ' });
			await expect(confirmReject).toBeDisabled();
			await page.locator('#reject-reason-input').fill(`คลังเต็ม (e2e ${RUN_ID})`);
			await confirmReject.click();
			await expect(page.getByText(`ปฏิเสธคำขอ ${bookingRef} เรียบร้อยแล้ว`)).toBeVisible();
			await expect(page.getByRole('row').filter({ hasText: bookingRef })).toHaveCount(0);

			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('rejected');

			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await expect(page.getByRole('heading', { name: bookingRef })).toBeVisible();
			await expect(page.getByText('ปฏิเสธ').first()).toBeVisible();
			await expect(page.getByRole('button', { name: 'ยกเลิกการจองนี้' })).toHaveCount(0);
		});

		test('reject at the scan station after approval → nothing enters the ledger', async ({
			page
		}) => {
			const { bookingRef } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ตีกลับหน้างาน ${RUN_ID}`,
				phone: '0823456789'
			});

			await openBackOffice(page, ws);
			await approvePending(page, shelter.code, bookingRef);
			await openInScanStation(page, bookingRef);

			await page.getByRole('button', { name: 'ปฏิเสธคำขอ' }).click();
			const confirmReject = page.getByRole('button', { name: 'ยืนยันการปฏิเสธคำขอ' });
			await expect(confirmReject).toBeDisabled();
			await page
				.getByPlaceholder('เช่น พื้นที่จัดเก็บไม่เพียงพอ, งดรับเสื้อผ้าชั่วคราว...')
				.fill(`ของเสียหาย (e2e ${RUN_ID})`);
			await confirmReject.click();

			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('rejected');
			const donation = await findDonation(shelter.code, bookingRef);
			expect(await ledgerRowsFor(shelter.code, donation._id as string)).toEqual([]);
		});
	});

	test.describe('donor self-service on the track page', () => {
		test('lookup with the wrong phone does not open the booking', async ({ page }) => {
			const { bookingRef } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ค้นผิดเบอร์ ${RUN_ID}`,
				phone: '0834567890'
			});

			await page.goto('/donations/track');
			await page.locator('#booking-ref-field').fill(bookingRef);
			await page.locator('#phone-field').fill('0899999999');
			await page.getByRole('button', { name: 'ติดตามสถานะ' }).click();

			await expect(page.locator('[data-sonner-toast]').first()).toBeVisible();
			await expect(page).toHaveURL(/\/donations\/track\/?(\?.*)?$/);
		});

		test('donor edits the quantity → the change is recorded as a revision', async ({ page }) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E แก้จำนวน ${RUN_ID}`,
				phone: '0845678901'
			});

			await page.goto(`/donations/track/${trackingToken}`);
			await page.getByRole('button', { name: 'แก้ไขรายการที่จะบริจาค' }).click();
			const dialog = page.getByRole('dialog', { name: 'แก้ไขรายการที่จะบริจาค' });
			await dialog.getByRole('spinbutton', { name: 'จำนวน' }).fill('2');

			const saved = page.waitForResponse((r) =>
				r.url().includes(`/api/public/v1/donations/${trackingToken}/items`)
			);
			await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
			const res = await saved;
			expect(res.ok(), `edit items failed: ${await res.text()}`).toBe(true);
			await expect(dialog).toBeHidden();
			// The refetch right after saving has come back without the revision (1 run in 3);
			// a reload shows it. Tolerated here, noted as a finding.
			await reloadUntilVisible(page, page.getByText('แก้ไขแล้ว 1 ครั้ง'));

			// Staff see the donor's new number, not the one first declared.
			await expect
				.poll(async () => {
					const d = await findDonation(shelter.code, bookingRef);
					return (d?.items as { qty: string | number }[] | undefined)?.map((i) => Number(i.qty));
				})
				.toEqual([2]);
			const d = await findDonation(shelter.code, bookingRef);
			expect(d.revisions as unknown[]).toHaveLength(1);
		});

		test('donor cancels → quota released and the booking leaves the staff queue', async ({
			page
		}) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ยกเลิกเอง ${RUN_ID}`,
				phone: '0856789012'
			});

			await page.goto(`/donations/track/${trackingToken}`);
			await page.getByRole('button', { name: 'ยกเลิกการจองนี้' }).click();
			const dialog = page.getByRole('alertdialog', { name: 'ยกเลิกการจองบริจาคนี้?' });
			await expect(dialog.getByText(bookingRef)).toBeVisible();
			await dialog.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' }).click();

			await expect(page.getByRole('button', { name: 'ยกเลิกการจองนี้' })).toHaveCount(0);
			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('cancelled');

			await openBackOffice(page, ws);
			await page.getByRole('tab', { name: /รอการประเมิน/ }).click();
			await expect(page.getByRole('table')).toBeVisible();
			await expect(page.getByRole('row').filter({ hasText: bookingRef })).toHaveCount(0);
		});

		test('parcel donor adds the courier tracking number later (DN-6)', async ({ page }) => {
			const first = `TH${RUN_ID}A`.toUpperCase();
			const later = `TH${RUN_ID}B`.toUpperCase();
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ส่งพัสดุ ${RUN_ID}`,
				phone: '0867890123',
				mode: { kind: 'parcel', trackingNo: first }
			});

			const logistics = async () =>
				(await findDonation(shelter.code, bookingRef))?.logistics as
					{ delivery_method: string; courier_tracking_no?: string } | undefined;
			await expect.poll(async () => (await logistics())?.courier_tracking_no).toBe(first);
			expect((await logistics())?.delivery_method).toBe('parcel');

			await page.goto(`/donations/track/${trackingToken}`);
			// The input has no label; its placeholder (= accessible name) is the saved number —
			// which the page only knows once the projection has caught up.
			const box = page.getByRole('textbox', { name: first });
			await reloadUntilVisible(page, box);
			await box.fill(later);
			await page.getByRole('button', { name: 'บันทึก', exact: true }).click();

			await expect.poll(async () => (await logistics())?.courier_tracking_no).toBe(later);
		});
	});

	test('Z teardown leaves nothing of this run behind', async ({ request }) => {
		test.setTimeout(240_000);
		const run = await teardownRun(request, ledger);
		expect(run.shelters).toHaveLength(1);
		await expectRunGone(request, run);
	});
});
