import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { clearSession } from './helpers/login';
import {
	RUN_ID,
	BOARD_SYNC,
	RunLedger,
	approvePending,
	bookMixedViaApi,
	expectReadyForDropoff,
	bookAsDonor,
	boardLineFor,
	catalogItem,
	createCampaignViaUi,
	createSystemAdmin,
	createWarehouseStaff,
	expectRunGone,
	fillExpiry,
	findDonation,
	ledgerRowsFor,
	openBackOffice,
	openInScanStation,
	rejectInDialog,
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
 * (`pnpm seed`). Locally use the dev server — only it skips reCAPTCHA keys:
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
 * (dropped by the worker within minutes).
 * Back-office setup (slots, walk-in) lives in donation-fullstack-admin.
 */

// A catalog item with `shelf_life_days`: receiving it needs an expiry (`fillExpiry`).
const NEED_ITEM = 'ยาสีฟัน';
// No `shelf_life_days`, so the scan station receives it without an expiry.
const SHELVED_ITEM = 'แปรงสีฟัน';

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
		test('campaign booking skips review → donor sees QR → receive into stock → donor sees received (CR-174 AC-1)', async ({
			page
		}) => {
			const phone = '0812345678';
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E รับของ ${RUN_ID}`,
				phone
			});

			await expectReadyForDropoff(shelter.code, bookingRef);
			const booked = await findDonation(shelter.code, bookingRef);
			expect((booked.items as { review_status?: string }[]).map((i) => i.review_status)).toEqual([
				'approved'
			]);

			// The QR is live from the start, and the donor can still hand it back (FR-20).
			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await expect(page.getByRole('img', { name: `QR Code for ${bookingRef}` })).toBeVisible();
			await expect(page.getByRole('button', { name: 'ยกเลิกการจองนี้' })).toBeVisible();
			await expect(page.getByText('อนุมัติแล้ว / รอนำส่ง')).toBeVisible();

			// ── Scan station: count it in ───────────────────────────────────────────
			// #617 — the old scan-tab link lands on the one list, filtered to drop-off, with
			// the status in Thai; opening the row goes straight to the counter.
			await openBackOffice(page, ws);
			await page.goto('/back-office/stock-donations?tab=scan');
			await expect(page.getByRole('tab', { name: /รายการของบริจาค/ })).toHaveAttribute(
				'aria-selected',
				'true'
			);
			await expect(page.getByRole('button', { name: /^รอมาส่ง/ })).toHaveAttribute(
				'aria-pressed',
				'true'
			);
			const listRow = page.getByRole('row').filter({ hasText: bookingRef });
			await expect(listRow).toContainText('กำลังตรวจรับที่ศูนย์');
			await listRow.getByRole('button', { name: 'จัดการ' }).click();
			await expect(
				page.getByRole('heading', { name: `${bookingRef} - ตรวจรับพัสดุบริจาค` })
			).toBeVisible();
			const confirm = page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' });
			await expect(confirm).toBeDisabled();
			await expect(page.getByRole('textbox', { name: 'จำนวนรับจริง *' })).toHaveValue('1');
			await page.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ }).click();
			// The run's own shelter has no storage points, so the line goes to the main
			// store without a pick (CR-139 N1).
			await expect(page.getByRole('button', { name: /^สถานที่จัดเก็บ/ })).toContainText('คลังหลัก');
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

		test('counted less than declared → staff see the gap, the donor only sees it received (decision sync 2026-10-22)', async ({
			page
		}) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E นับได้ครึ่งเดียว ${RUN_ID}`,
				phone: '0812345690',
				qty: 2
			});
			await expectReadyForDropoff(shelter.code, bookingRef);

			await openBackOffice(page, ws);
			await openInScanStation(page, bookingRef);
			await page.getByRole('textbox', { name: 'จำนวนรับจริง *' }).fill('1');
			// Staff still see the gap at the counter (CR-156 FR-I1).
			await expect(page.getByText(/น้อยกว่าที่แจ้ง\s*1/)).toBeVisible();
			await page.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ }).click();
			await fillExpiry(page.getByRole('textbox', { name: 'วันหมดอายุ' }));
			const received = page.waitForResponse(
				(r) =>
					r.url().endsWith(`/api/back-office/donations/${bookingRef}`) &&
					r.request().method() === 'POST'
			);
			await page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' }).click();
			expect((await received).ok()).toBe(true);

			// The shortfall is still recorded — only the donor's page stops showing it.
			const donation = await findDonation(shelter.code, bookingRef);
			expect(donation.status).toBe('received');
			expect((donation.received_summary as { shortfalls?: unknown[] }).shortfalls).toEqual([
				expect.objectContaining({ item_id: need.item_id, short: '1' })
			]);

			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await reloadUntilVisible(
				page,
				page.getByRole('heading', { name: 'ศูนย์รับของเรียบร้อยแล้ว' })
			);
			await expect(page.getByText(/ไม่ครบ|ขาด \d/)).toHaveCount(0);
		});

		test('reject from the pending queue → donor sees it rejected', async ({ page }) => {
			// Only a typed-in line waits in the queue (CR-174).
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				unsolicited: { itemName: `ผ้าห่มเก่า ${RUN_ID}`, unitLabel: 'กล่อง' },
				ledger,
				donorName: `E2E ปฏิเสธ ${RUN_ID}`,
				phone: '0898765432'
			});

			await openBackOffice(page, ws);
			await openPendingRow(page, bookingRef);
			// "อื่นๆ" reads as the detail alone — the exact text the donor must see (CR-172 AC-1).
			await rejectInDialog(page, /^อื่นๆ$/, `คลังเต็ม (e2e ${RUN_ID})`, { noteRequired: true });
			await expect(page.getByText(`ปฏิเสธคำขอ ${bookingRef} เรียบร้อยแล้ว`)).toBeVisible();
			await expect(page.getByRole('row').filter({ hasText: bookingRef })).toHaveCount(0);

			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('rejected');

			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await expect(page.getByRole('heading', { name: bookingRef })).toBeVisible();
			await expect(page.getByTestId('donation-reject-reason')).toContainText(
				`คลังเต็ม (e2e ${RUN_ID})`
			);
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
			await expectReadyForDropoff(shelter.code, bookingRef);
			await openInScanStation(page, bookingRef);

			await rejectInDialog(page, /ชำรุดเสียหาย/, `กล่องเปียก (e2e ${RUN_ID})`);

			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('rejected');
			const donation = await findDonation(shelter.code, bookingRef);
			expect(donation).toMatchObject({
				reject_reason: `ชำรุดเสียหาย — กล่องเปียก (e2e ${RUN_ID})`,
				reject_reason_code: 'damaged'
			});
			expect(await ledgerRowsFor(shelter.code, donation._id as string)).toEqual([]);
		});

		test('turning every line away at the counter rejects the booking with the line reason (CR-172 AC-3)', async ({
			page
		}) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				need,
				ledger,
				donorName: `E2E ไม่รับรายการ ${RUN_ID}`,
				phone: '0823456790'
			});

			await openBackOffice(page, ws);
			await expectReadyForDropoff(shelter.code, bookingRef);
			await openInScanStation(page, bookingRef);

			await page.getByRole('button', { name: /^ไม่รับรายการนี้/ }).click();
			const confirm = page.getByRole('button', { name: 'ปฏิเสธทั้งใบ' });
			await expect(confirm).toBeDisabled();
			await page.getByRole('radio', { name: /^หมดอายุ$/ }).click();
			await expect(page.getByTestId('line-0-reject-preview')).toHaveText('หมดอายุ');
			await confirm.click();

			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
				.toBe('rejected');
			const donation = await findDonation(shelter.code, bookingRef);
			expect(donation).toMatchObject({ reject_reason: 'หมดอายุ', reject_reason_code: 'expired' });
			expect(await ledgerRowsFor(shelter.code, donation._id as string)).toEqual([]);

			await clearSession(page);
			await page.goto(`/donations/track/${trackingToken}`);
			await expect(page.getByTestId('donation-reject-reason')).toContainText('หมดอายุ');
			await expect(page.getByText('ไม่รับ', { exact: true })).toBeVisible();
		});
	});

	/** Book campaign line + typed line, then wait for CouchDB to hold it in review. */
	async function bookMixed(
		request: APIRequestContext,
		typedItem: string,
		donorName: string,
		phone: string
	) {
		const needItem = await catalogItem(NEED_ITEM);
		const booking = await bookMixedViaApi(request, {
			shelter,
			need,
			needUnit: needItem.unit,
			typedItem,
			donorName,
			phone,
			ledger
		});
		// Campaign line approved by the rule, typed line waiting (CR-174 AC-2).
		await expect
			.poll(async () => (await findDonation(shelter.code, booking.bookingRef))?.status, {
				timeout: 30_000
			})
			.toBe('pending_review');
		return booking;
	}

	/** Count the campaign line in and confirm a receipt that keeps one line and refuses one. */
	async function receiveCampaignLineOnly(page: Page) {
		await page
			.getByRole('group', { name: `ผลการตรวจรับ ${need.name}` })
			.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ })
			.click();
		await fillExpiry(page.getByRole('textbox', { name: 'วันหมดอายุ' }));
		await page.getByRole('button', { name: 'รับ 1 รายการ · ไม่รับ 1 รายการ' }).click();
	}

	test('mixed booking: review refuses the typed line, the campaign line is received, the donor reads why (CR-174 AC-2, AC-3)', async ({
		page,
		request
	}) => {
		const typed = `ผ้าห่มมือสอง ${RUN_ID}`;
		const { bookingRef, trackingToken } = await bookMixed(
			request,
			typed,
			`E2E ใบผสมประเมิน ${RUN_ID}`,
			'0823456791'
		);

		await openBackOffice(page, ws);
		await openPendingRow(page, bookingRef);
		// The campaign line is shown, not decided (FR-8); only the typed line takes a decision.
		await expect(page.getByText('อยู่ในแคมเปญ · อนุมัติอัตโนมัติ')).toBeVisible();
		await page.getByRole('button', { name: /^ไม่รับรายการนี้/ }).click();
		await page.getByRole('radio', { name: /ชำรุดเสียหาย/ }).click();
		await page
			.getByRole('textbox', { name: /รายละเอียดเพิ่มเติม/ })
			.fill(`ขาดเป็นรู (e2e ${RUN_ID})`);
		await page.getByRole('button', { name: 'บันทึกผลการประเมิน' }).click();
		// One line still approved: the booking goes to drop-off, not rejected (AC-3).
		await expectReadyForDropoff(shelter.code, bookingRef);
		const reviewed = await findDonation(shelter.code, bookingRef);
		expect((reviewed.items as { review_status?: string }[]).map((i) => i.review_status)).toEqual([
			'approved',
			'rejected'
		]);

		// The counter shows the refusal as settled and receives only the campaign line.
		await openBackOffice(page, ws);
		await openInScanStation(page, bookingRef);
		await expect(page.getByText('ไม่รับตั้งแต่ตอนประเมิน')).toBeVisible();
		await receiveCampaignLineOnly(page);
		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
			.toBe('received');
		const received = await findDonation(shelter.code, bookingRef);
		expect(await ledgerRowsFor(shelter.code, received._id as string)).toHaveLength(1);

		await clearSession(page);
		await page.goto(`/donations/track/${trackingToken}`);
		await expect(page.getByText('ไม่รับ', { exact: true })).toBeVisible();
		await expect(page.getByText(`ชำรุดเสียหาย — ขาดเป็นรู (e2e ${RUN_ID})`)).toBeVisible();
		await expect(page.getByText(/รับไม่ครบ/)).toHaveCount(0);
	});

	test('mixed booking: the counter turns one line away and receives the other (CR-172 AC-2)', async ({
		page,
		request
	}) => {
		const typed = `หมอนเก่า ${RUN_ID}`;
		const { bookingRef, trackingToken } = await bookMixed(
			request,
			typed,
			`E2E ใบผสมหน้างาน ${RUN_ID}`,
			'0823456792'
		);
		await openBackOffice(page, ws);
		await approvePending(page, shelter.code, bookingRef);

		await openBackOffice(page, ws);
		await openInScanStation(page, bookingRef);
		await page
			.getByRole('group', { name: `ผลการตรวจรับ ${typed}` })
			.getByRole('button', { name: /^ไม่รับรายการนี้/ })
			.click();
		await page.getByRole('radio', { name: /^หมดอายุ$/ }).click();
		await receiveCampaignLineOnly(page);

		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
			.toBe('received');
		const received = await findDonation(shelter.code, bookingRef);
		expect(await ledgerRowsFor(shelter.code, received._id as string)).toHaveLength(1);
		// "ไม่รับ" is not "ขาด" (FR-13).
		expect((received.received_summary as { shortfalls?: unknown[] }).shortfalls).toEqual([]);

		await clearSession(page);
		await page.goto(`/donations/track/${trackingToken}`);
		await expect(page.getByText('ไม่รับ', { exact: true })).toBeVisible();
		await expect(page.getByText('หมดอายุ', { exact: true })).toBeVisible();
		await expect(page.getByText(/รับไม่ครบ/)).toHaveCount(0);
	});

	test('mixed booking: review waits for a reason on every refusal, and the donor can no longer edit it (CR-172 AC-4, CR-196 AC-2)', async ({
		page,
		request
	}) => {
		const typed = `ผ้าปูที่นอน ${RUN_ID}`;
		const note = `ไม่ใช่ของที่ศูนย์ต้องการ (e2e ${RUN_ID})`;
		const { bookingRef, trackingToken } = await bookMixed(
			request,
			typed,
			`E2E ใบผสมแก้ภายหลัง ${RUN_ID}`,
			'0823456793'
		);

		await openBackOffice(page, ws);
		await openPendingRow(page, bookingRef);
		const save = page.getByRole('button', { name: 'บันทึกผลการประเมิน' });
		const hint = page.getByText('ตัดสินรายการที่รอประเมินให้ครบ และใส่เหตุผลของรายการที่ไม่รับ');
		// Undecided, refused with no reason, "อื่นๆ" with no detail: none of them saves.
		await expect(save).toBeDisabled();
		await expect(hint).toBeVisible();
		await page.getByRole('button', { name: /^ไม่รับรายการนี้/ }).click();
		await expect(save).toBeDisabled();
		await page.getByRole('radio', { name: /^อื่นๆ$/ }).click();
		const noteBox = page.getByRole('textbox', { name: /รายละเอียดเพิ่มเติม/ });
		await expect(noteBox).toHaveAttribute('aria-required', 'true');
		await expect(save).toBeDisabled();
		await noteBox.fill(note);
		await expect(hint).toBeHidden();
		await save.click();
		await expectReadyForDropoff(shelter.code, bookingRef);

		// Reviewed: the edit button stays where it was but only explains why (CR-196 FR-LK-4).
		await clearSession(page);
		const before = await findDonation(shelter.code, bookingRef);
		let patched = false;
		page.on('request', (r) => {
			if (r.method() === 'PATCH' && r.url().includes(`/donations/${trackingToken}/items`)) {
				patched = true;
			}
		});
		await page.goto(`/donations/track/${trackingToken}`);
		const edit = page.getByRole('button', { name: 'แก้ไขรายการที่จะบริจาค' });
		await expect(edit).toHaveAttribute('aria-disabled', 'true');
		await edit.click();
		await expect(
			page.locator('[data-sonner-toast]').filter({ hasText: 'ไม่สามารถแก้ไขรายการได้' })
		).toBeVisible();
		await expect(page.getByRole('dialog', { name: 'แก้ไขรายการที่จะบริจาค' })).toHaveCount(0);

		const after = await findDonation(shelter.code, bookingRef);
		expect(patched).toBe(false);
		expect(after.status).toBe('verifying');
		expect(after.items).toEqual(before.items);
		expect((after.items as Record<string, unknown>[]).map((i) => i.review_status)).toEqual([
			'approved',
			'rejected'
		]);
	});

	test('donor cancels a booking still under review → no line reads as awaiting review', async ({
		page,
		request
	}) => {
		const typed = `ตะเกียง ${RUN_ID}`;
		const { bookingRef, trackingToken } = await bookMixed(
			request,
			typed,
			`E2E ยกเลิกระหว่างประเมิน ${RUN_ID}`,
			'0823456794'
		);

		await page.goto(`/donations/track/${trackingToken}`);
		const pendingBadge = page.getByText('รอประเมิน', { exact: true });
		await reloadUntilVisible(page, pendingBadge);
		await page.getByRole('button', { name: 'ยกเลิกการจองนี้' }).click();
		await page
			.getByRole('alertdialog', { name: 'ยกเลิกการจองบริจาคนี้?' })
			.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' })
			.click();
		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
			.toBe('cancelled');

		// The line keeps `review_status: pending` on file; the page must not show it as live.
		await page.reload();
		await expect(page.getByText(typed)).toBeVisible();
		await expect(pendingBadge).toHaveCount(0);
	});

	test('refusing every line of a typed-only booking turns the save red and rejects it (CR-174 FR-6)', async ({
		page
	}) => {
		const { bookingRef, trackingToken } = await bookAsDonor(page, {
			shelter,
			unsolicited: { itemName: `เตารีดเก่า ${RUN_ID}`, unitLabel: 'กล่อง' },
			ledger,
			donorName: `E2E ไม่รับทุกรายการ ${RUN_ID}`,
			phone: '0823456795'
		});

		await openBackOffice(page, ws);
		await openPendingRow(page, bookingRef);
		await page.getByRole('button', { name: /^ไม่รับรายการนี้/ }).click();
		await page.getByRole('radio', { name: /ชำรุดเสียหาย/ }).click();
		const rejectAll = page.getByRole('button', { name: 'ปฏิเสธทั้งใบ' });
		await expect(rejectAll).toBeEnabled();
		await expect(rejectAll).toHaveClass(/bg-red-600/);
		await rejectAll.click();
		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
			.toBe('rejected');

		await clearSession(page);
		await page.goto(`/donations/track/${trackingToken}`);
		await expect(page.getByTestId('donation-reject-reason')).toContainText('ชำรุดเสียหาย');
		await expect(page.getByText('รอประเมิน', { exact: true })).toHaveCount(0);
	});

	test('typed-in item in another unit maps to a stock item and is received in its own unit (#623, #636, #638)', async ({
		page
	}) => {
		// The donor types the item and counts it in boxes; the stock item counts pieces.
		// Mapping the line used to keep the donor's "box" and every receipt failed with
		// CATALOG_MISMATCH ("expected piece, got box"). Not SHELVED_ITEM: the stock this
		// receipt leaves on the run's shelter would close that test's campaign on arrival.
		const diaper = await catalogItem('ผ้าอ้อมเด็ก ไซส์ M');
		const { bookingRef } = await bookAsDonor(page, {
			shelter,
			ledger,
			unsolicited: { itemName: `ผ้าอ้อมเด็กยกกล่อง ${RUN_ID}`, unitLabel: 'กล่อง' },
			donorName: `E2E หน่วยไม่ตรง ${RUN_ID}`,
			phone: '0867770011'
		});

		await openBackOffice(page, ws);
		await approvePending(page, shelter.code, bookingRef);
		await openBackOffice(page, ws);
		await openInScanStation(page, bookingRef);

		// What the donor declared stays visible, in their unit and in Thai.
		await expect(page.getByText(/แจ้งไว้\s*1\s*กล่อง/)).toBeVisible();

		// "เพิ่มสินค้าใหม่" beside the picker opens the create form in a side sheet, started
		// from what the donor typed. Cancelled here: an item created by the run would stay
		// in the catalog after teardown.
		await page.getByRole('button', { name: 'เพิ่มสินค้าใหม่' }).click();
		const createSheet = page.getByRole('dialog', { name: 'สร้างสินค้าใหม่' });
		await expect(createSheet).toBeVisible();
		await expect(createSheet.locator('#qc-name')).toHaveValue(`ผ้าอ้อมเด็กยกกล่อง ${RUN_ID}`);
		await createSheet.getByRole('button', { name: 'ยกเลิก' }).click();
		await expect(createSheet).toBeHidden();

		// Searchable picker (#638); its rows show the unit in Thai, not the raw code (#636).
		const picker = page.getByRole('combobox', { name: /^รายการในคลัง/ });
		// Thai text is inserted without key events, so open the list with ArrowDown first.
		await picker.click();
		await picker.press('ArrowDown');
		await picker.pressSequentially('ผ้าอ้อมเด็ก');
		const option = page.getByRole('option', { name: /^ผ้าอ้อมเด็ก ไซส์ M/ }).first();
		await expect(option).toContainText('ชิ้น');
		await expect(option).not.toContainText('piece');
		await option.click();

		await page.getByRole('textbox', { name: 'จำนวนรับจริง *' }).fill('12');
		// Diapers carry a shelf life, so the lot needs an expiry before it can be received.
		await fillExpiry(page.getByRole('textbox', { name: 'วันหมดอายุ' }));
		// Boxes against pieces do not compare, so no "more/less than declared" badge.
		await expect(page.getByText(/(มากกว่า|น้อยกว่า)ที่แจ้ง/)).toHaveCount(0);
		await page.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ }).click();
		const confirm = page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' });
		await expect(confirm).toBeEnabled();

		const received = page.waitForResponse(
			(r) =>
				r.url().endsWith(`/api/back-office/donations/${bookingRef}`) &&
				r.request().method() === 'POST'
		);
		await confirm.click();
		const res = await received;
		expect(res.ok(), `receive failed: ${await res.text()}`).toBe(true);

		const donation = await findDonation(shelter.code, bookingRef);
		expect(donation.status).toBe('received');
		const rows = (await ledgerRowsFor(shelter.code, donation._id as string)) as {
			item_id: string;
			qty: string;
			unit?: string;
			lot?: { lot_no?: string };
		}[];
		expect(rows).toEqual([
			expect.objectContaining({ item_id: diaper.id, qty: '12', unit: diaper.unit })
		]);

		// The lot panel names the item and links into the stock movements for that lot.
		const lotNo = rows[0].lot?.lot_no;
		expect(lotNo, 'receipt minted no lot number').toBeTruthy();
		await expect(page.getByText('เลขล็อตที่ระบบออกให้ (เขียนติดกล่อง)')).toBeVisible();
		await expect(page.getByText('ผ้าอ้อมเด็ก ไซส์ M', { exact: true })).toBeVisible();
		const toStock = page.getByRole('link', { name: 'ดูในคลัง' }).first();
		await expect(toStock).toHaveAttribute('href', new RegExp(`tab=movements&lq=${lotNo}`));
		await toStock.click();
		await expect(page).toHaveURL(/\/back-office\/supply\?tab=movements/);
		await expect(page.getByText(lotNo!).first()).toBeVisible({ timeout: 15_000 });
	});

	test('goods received into stock leave the whole remaining need bookable', async ({
		page,
		request,
		browser
	}) => {
		// The need's quota counter caps a booking at qty_target − on_hand − reserved. A
		// received donation used to stay in `reserved` after its goods reached the ledger
		// (and so `on_hand`), so the board showed 2 open while a booking of 2 came back
		// NEED_FULL. Own campaign and item: the board sums an item across campaigns.
		const context = await browser.newContext();
		let brushNeed: PublicNeed;
		try {
			brushNeed = await createCampaignViaUi(await context.newPage(), request, ws, shelter.code, {
				item: SHELVED_ITEM,
				target: 3,
				notes: `e2e shelved ${RUN_ID}`
			});
		} finally {
			await context.close();
		}
		expect(Number(brushNeed.qty_needed)).toBe(3);

		// ── Donor 1 brings one in; staff receive it into stock ───────────────────
		const first = await bookAsDonor(page, {
			shelter,
			need: brushNeed,
			ledger,
			donorName: `E2E ของเข้าคลัง ${RUN_ID}`,
			phone: '0867770001'
		});
		await openBackOffice(page, ws);
		await expectReadyForDropoff(shelter.code, first.bookingRef);
		await openBackOffice(page, ws);
		await openInScanStation(page, first.bookingRef);
		await page.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ }).click();
		// No storage points on the run's own shelter: the line goes to the main store.
		await expect(page.getByRole('button', { name: /^สถานที่จัดเก็บ/ })).toContainText('คลังหลัก');
		const confirm = page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' });
		await expect(confirm).toBeEnabled();
		const received = page.waitForResponse(
			(r) =>
				r.url().endsWith(`/api/back-office/donations/${first.bookingRef}`) &&
				r.request().method() === 'POST'
		);
		await confirm.click();
		expect((await received).ok()).toBe(true);

		// The worker settles the counter before it re-projects the board, so once the
		// board shows the unit on the shelf the counter has let go of it too.
		await expect
			.poll(async () => {
				const line = await boardLineFor(request, shelter.code, SHELVED_ITEM);
				return line && [Number(line.on_hand), Number(line.qty_needed)];
			}, BOARD_SYNC)
			.toEqual([1, 2]);

		// ── Donor 2 books everything the board still asks for ────────────────────
		await clearSession(page);
		await bookAsDonor(page, {
			shelter,
			need: brushNeed,
			ledger,
			donorName: `E2E จองที่เหลือ ${RUN_ID}`,
			phone: '0867770002',
			qty: 2
		});

		// Filled — the board stops offering it.
		await expect
			.poll(
				async () => (await boardLineFor(request, shelter.code, SHELVED_ITEM))?.status ?? 'gone',
				BOARD_SYNC
			)
			.not.toBe('open');
	});

	test('a booking for another shelter is not received while working in this one', async ({
		page
	}) => {
		// A system admin can open any shelter's booking, but the goods are at the counter
		// of the shelter they are working in. Receiving it would book the stock into the
		// booking's shelter instead, so the scan station holds both actions until they
		// switch to that shelter.
		const admin = await createSystemAdmin(ledger, 'sa');
		const { bookingRef } = await bookAsDonor(page, {
			shelter,
			need,
			ledger,
			donorName: `E2E ผิดศูนย์ ${RUN_ID}`,
			phone: '0867770021'
		});
		await openBackOffice(page, ws);
		await expectReadyForDropoff(shelter.code, bookingRef);

		await openBackOffice(page, admin, 'SH001');
		await openInScanStation(page, bookingRef);
		const wrongShelter = page.getByRole('alert').filter({ hasText: 'ใบนี้จองส่งไปศูนย์' });
		await expect(wrongShelter).toContainText('SH001');
		await expect(page.getByRole('button', { name: 'ยืนยันรับเข้าคลัง' })).toBeDisabled();
		await expect(page.getByRole('button', { name: 'ปฏิเสธคำขอ' })).toBeDisabled();

		await openBackOffice(page, admin, shelter.code);
		await openInScanStation(page, bookingRef);
		await expect(page.getByText('ใบนี้จองส่งไปศูนย์')).toHaveCount(0);
		// Working in the booking's shelter, the actions are back — and closing the booking
		// here keeps the run's teardown, which wants every booking finished, satisfied.
		await rejectInDialog(page, /^อื่นๆ$/, `ส่งผิดศูนย์ (e2e ${RUN_ID})`);
		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status)
			.toBe('rejected');
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

		// A typed-in item waits for review, so nothing is decided and the booking is still the
		// donor's to edit (CR-196 FR-LK-4). The line keeps its key across the edit (FR-LK-2).
		test('donor edits the quantity → the change is recorded as a revision', async ({ page }) => {
			const { bookingRef, trackingToken } = await bookAsDonor(page, {
				shelter,
				unsolicited: { itemName: `ผ้าขนหนู ${RUN_ID}`, unitLabel: 'กล่อง' },
				ledger,
				donorName: `E2E แก้จำนวน ${RUN_ID}`,
				phone: '0845678901'
			});
			await expect
				.poll(async () => (await findDonation(shelter.code, bookingRef))?.status, {
					timeout: 30_000
				})
				.toBe('pending_review');
			const booked = await findDonation(shelter.code, bookingRef);
			const [lineKey] = (booked.items as { line_key?: string }[]).map((i) => i.line_key);
			expect(lineKey).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

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
			expect((d.items as { line_key?: string }[])[0]?.line_key).toBe(lineKey);
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
			await page.getByRole('tab', { name: /รายการของบริจาค/ }).click();
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
