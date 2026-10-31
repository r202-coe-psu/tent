import { test, expect, type Page } from '@playwright/test';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import { couchReq } from './helpers/couch';
import { clearSession } from './helpers/login';
import {
	RUN_ID,
	RunLedger,
	catalogItem,
	createCampaignViaUi,
	createWarehouseStaff,
	expectReadyForDropoff,
	expectRunGone,
	findDonation,
	ledgerRowsFor,
	openBackOffice,
	openInScanStation,
	provisionShelter,
	reloadUntilVisible,
	shelterDb,
	suspendRecaptcha,
	teardownRun,
	type Booking,
	type PublicNeed,
	type PublicShelter,
	type Staff
} from './helpers/donation-fullstack';
import {
	bookSplitAsDonor,
	bookSplitViaApi,
	setDonationPoints,
	type DonationPointSeed,
	type SplitLine
} from './helpers/donation-points';
import { deriveDonationCloseAuditId } from '../src/lib/features/operations/domain/donation-batch';

/**
 * CR-206 — one booking split across a shelter's drop-off points, against the REAL stack
 * (no route mocks), on this run's own `E2E Donation points …` shelter (README §4).
 *
 * The shelter gets two drop-off points ("โรงยิม", "ห้องพยาบาล") straight on its registry
 * master (`setDonationPoints`). The campaign item has no `shelf_life_days`, so the scan
 * station receives it without an expiry. A booking binds one campaign and a campaign holds
 * one item, so a split campaign booking has two lines of that item, one per point; the
 * wizard books one campaign line at a time, so it comes from the BFF (`bookSplitViaApi`).
 * The wizard's per-line picker is driven with typed-in lines (AC-1).
 *
 * Teardown (`teardownRun`) cancels what is still open; a booking some point already
 * received answers 409 GOODS_IN_STOCK, which is why every booking this spec leaves open is
 * closed by the test itself.
 */

const ITEM_A = 'แปรงสีฟัน';

const GYM: DonationPointSeed = {
	id: `e2e-gym-${RUN_ID}`,
	name: 'โรงยิม',
	lat: 7.0062,
	lng: 100.4981
};
const CLINIC: DonationPointSeed = {
	id: `e2e-clinic-${RUN_ID}`,
	name: 'ห้องพยาบาล',
	lat: 7.0058,
	lng: 100.4986
};

const ledger = new RunLedger('donation-multi-drop-off');

let shelter: PublicShelter;
let ws: Staff;
let needA: PublicNeed;
let unitA: string;
let restoreRecaptcha: (() => Promise<void>) | undefined;

// Booked in AC-1/AC-5 and carried through AC-9 and AC-6.
let main: Booking;

type DonationDoc = {
	_id: string;
	status: string;
	items: { drop_off_point_id?: string | null }[];
	point_receipts?: { point_id: string | null; line_nos: number[] }[];
	received_summary?: {
		items: unknown[];
		shortfalls: { item_id: string; declared: string; counted: string; short: string }[];
		closed_reason?: string;
		closed_by?: string;
	};
};

const donationOf = async (ref: string) => (await findDonation(shelter.code, ref)) as DonationDoc;

const lines = (a: DonationPointSeed, b: DonationPointSeed): SplitLine[] => [
	{ need: needA, unit: unitA, pointId: a.id },
	{ need: needA, unit: unitA, pointId: b.id }
];

/** The scan station of `ref`, working at `point` ("จุดที่ประจำ"). */
async function scanAt(page: Page, ref: string, point: DonationPointSeed) {
	await openBackOffice(page, ws);
	await openInScanStation(page, ref);
	const trigger = page.getByTestId('receiving-point-trigger');
	await trigger.click();
	await page.getByRole('option', { name: point.name }).click();
	await expect(trigger).toContainText(point.name);
}

/** Tick the line as checked and press save; resolves when the receive POST answers OK. */
async function receiveLine(page: Page, ref: string, lineNo: number) {
	await page
		.getByTestId(`scan-line-${lineNo}`)
		.getByRole('button', { name: /^ผ่านการตรวจสอบแล้ว/ })
		.click();
	const submit = page.getByTestId('scan-receive-submit');
	await expect(submit).toBeEnabled();
	const received = page.waitForResponse(
		(r) => r.url().endsWith(`/api/back-office/donations/${ref}`) && r.request().method() === 'POST'
	);
	await submit.click();
	const res = await received;
	expect(res.ok(), `receive failed: ${await res.text()}`).toBe(true);
}

async function trackPage(page: Page, token: string) {
	await clearSession(page);
	await page.goto(`/donations/track/${token}`);
	return page.getByTestId('drop-off-group');
}

function groupOf(page: Page, point: DonationPointSeed) {
	return page.locator(`[data-testid="drop-off-group"][data-point-id="${point.id}"]`);
}

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

test.describe('Donation multi drop-off points (CR-206)', { tag: ['@donation'] }, () => {
	test.describe.configure({ mode: 'serial', timeout: 240_000 });

	test.beforeAll(async ({ request, browser }) => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(420_000);
		restoreRecaptcha = await suspendRecaptcha(browser);
		const created = await provisionShelter(browser, ledger, 'points');
		ws = await createWarehouseStaff(ledger, created.code, 'ws');
		await setDonationPoints(created.code, [GYM, CLINIC]);

		const context = await browser.newContext();
		try {
			const page = await context.newPage();
			needA = await createCampaignViaUi(page, request, ws, created.code, {
				item: ITEM_A,
				target: 50,
				notes: `e2e points ${RUN_ID}`
			});
		} finally {
			await context.close();
		}
		unitA = (await catalogItem(ITEM_A)).unit;
		shelter = { ...created, needs: [needA] };
	});

	test.afterAll(async ({ request }) => {
		if (!CAN_WRITE) return;
		test.setTimeout(240_000);
		await restoreRecaptcha?.();
		await teardownRun(request, ledger);
	});

	test('AC-1: the donor sends each line to its own point; the doc and the track page keep the split', async ({
		page
	}) => {
		const typedA = `น้ำดื่ม e2e ${RUN_ID}`;
		const typedB = `ยาสามัญ e2e ${RUN_ID}`;
		const { bookingRef, trackingToken } = await bookSplitAsDonor(page, {
			shelter,
			lines: [
				{ itemName: typedA, pointName: GYM.name },
				{ itemName: typedB, pointName: CLINIC.name }
			],
			donorName: `E2E หลายจุด ${RUN_ID}`,
			phone: '0867770031',
			ledger
		});

		await expect
			.poll(async () => (await findDonation(shelter.code, bookingRef))?.status, {
				timeout: 30_000
			})
			.toBe('pending_review');
		const booked = await donationOf(bookingRef);
		expect(booked.items.map((i) => i.drop_off_point_id)).toEqual([GYM.id, CLINIC.id]);

		await trackPage(page, trackingToken);
		await expect(page.getByTestId('drop-off-groups')).toBeVisible();
		await expect(page.getByTestId('drop-off-group')).toHaveCount(2);
		await expect(groupOf(page, GYM)).toContainText(typedA);
		await expect(groupOf(page, CLINIC)).toContainText(typedB);
		await expect(page.getByTestId('drop-off-group-status')).toHaveText(['รอรับ', 'รอรับ']);
	});

	test('AC-5: staff at the gym receive only the gym line; the clinic line waits (FR-MP-18, 19, 20)', async ({
		page,
		request
	}) => {
		main = await bookSplitViaApi(request, {
			shelter,
			lines: lines(GYM, CLINIC),
			donorName: `E2E รับทีละจุด ${RUN_ID}`,
			phone: '0867770032',
			ledger
		});
		await expectReadyForDropoff(shelter.code, main.bookingRef);
		const before = await donationOf(main.bookingRef);
		expect(before.items.map((i) => i.drop_off_point_id)).toEqual([GYM.id, CLINIC.id]);

		await openBackOffice(page, ws);
		await openInScanStation(page, main.bookingRef);
		// Scanning and reading the booking comes before picking a point; saving does not.
		await expect(page.getByTestId('receiving-point')).toBeVisible();
		await expect(page.getByTestId('scan-receive-submit')).toBeDisabled();

		const trigger = page.getByTestId('receiving-point-trigger');
		await trigger.click();
		await page.getByRole('option', { name: GYM.name }).click();
		await expect(trigger).toContainText(GYM.name);

		await expect(page.getByTestId('scan-line-0')).toHaveAttribute('data-line-state', 'receivable');
		await expect(page.getByTestId('scan-line-0-point')).toContainText(GYM.name);
		await expect(page.getByTestId('scan-line-1')).toHaveAttribute('data-line-state', 'other_point');
		await expect(page.getByTestId('scan-line-1-point')).toContainText(CLINIC.name);
		await expect(page.getByTestId('scan-line-1-other-point')).toContainText(CLINIC.name);

		await receiveLine(page, main.bookingRef, 0);

		await expect
			.poll(async () => (await donationOf(main.bookingRef)).point_receipts?.length)
			.toBe(1);
		const after = await donationOf(main.bookingRef);
		expect(after.point_receipts).toEqual([
			expect.objectContaining({ point_id: GYM.id, line_nos: [0] })
		]);
		expect(after.items).toEqual(before.items);
		expect(after.status).toBe(before.status);
		expect(after.received_summary).toBeUndefined();

		const rows = (await ledgerRowsFor(shelter.code, after._id)) as {
			item_id: string;
			lot?: { storage_point_id?: string };
		}[];
		expect(rows).toEqual([
			expect.objectContaining({
				item_id: needA.item_id,
				lot: expect.objectContaining({ storage_point_id: GYM.id })
			})
		]);

		await trackPage(page, main.trackingToken);
		await reloadUntilVisible(
			page,
			groupOf(page, GYM).getByTestId('drop-off-group-status').filter({
				hasText: 'รับแล้ว'
			})
		);
		await expect(groupOf(page, GYM).getByTestId('drop-off-group-status')).toHaveText('รับแล้ว');
		await expect(groupOf(page, CLINIC).getByTestId('drop-off-group-status')).toHaveText('รอรับ');
	});

	test('AC-9: once a point has received, the donor can no longer cancel or edit (FR-MP-17)', async ({
		page,
		request
	}) => {
		await trackPage(page, main.trackingToken);
		const cancel = page.getByTestId('cancel-donation-btn');
		const edit = page.getByTestId('edit-donation-items-btn');
		await reloadUntilVisible(page, cancel.and(page.locator('[aria-disabled="true"]')));
		await expect(edit).toHaveAttribute('aria-disabled', 'true');

		await cancel.click({ force: true });
		await expect(
			page.locator('[data-sonner-toast]').filter({ hasText: 'ศูนย์เริ่มรับของของใบนี้แล้ว' })
		).toBeVisible();
		await expect(page.getByRole('alertdialog')).toHaveCount(0);
		await expect(page.getByRole('dialog')).toHaveCount(0);

		const res = await request.delete(`/api/public/v1/donations/${main.trackingToken}`);
		expect(res.status()).toBe(409);
		expect(await res.json()).toMatchObject({ error: 'GOODS_IN_STOCK' });
		expect((await donationOf(main.bookingRef)).status).toBe('verifying');
	});

	test('AC-6: the clinic receives the last line and the booking closes itself (all_points)', async ({
		page
	}) => {
		await scanAt(page, main.bookingRef, CLINIC);
		await expect(page.getByTestId('scan-line-0')).toHaveAttribute('data-line-state', 'recorded');
		await expect(page.getByTestId('scan-line-0-recorded')).toContainText(GYM.name);
		await expect(page.getByTestId('scan-line-1')).toHaveAttribute('data-line-state', 'receivable');

		await receiveLine(page, main.bookingRef, 1);

		await expect.poll(async () => (await donationOf(main.bookingRef)).status).toBe('received');
		const closed = await donationOf(main.bookingRef);
		expect(closed.point_receipts?.map((r) => [r.point_id, r.line_nos])).toEqual([
			[GYM.id, [0]],
			[CLINIC.id, [1]]
		]);
		expect(closed.received_summary?.items).toHaveLength(2);
		expect(closed.received_summary?.closed_reason).toBe('all_points');
		expect(await ledgerRowsFor(shelter.code, closed._id)).toHaveLength(2);

		await trackPage(page, main.trackingToken);
		await reloadUntilVisible(page, page.getByRole('heading', { name: 'ศูนย์รับของเรียบร้อยแล้ว' }));
	});

	test('AC-7: staff close a booking whose clinic line never came; it lands in shortfalls (staff_close)', async ({
		page,
		request
	}) => {
		const { bookingRef } = await bookSplitViaApi(request, {
			shelter,
			lines: lines(GYM, CLINIC),
			donorName: `E2E ปิดใบ ${RUN_ID}`,
			phone: '0867770033',
			ledger
		});
		await expectReadyForDropoff(shelter.code, bookingRef);

		await scanAt(page, bookingRef, GYM);
		await expect(page.getByTestId('close-donation-button')).toHaveCount(0);
		await receiveLine(page, bookingRef, 0);
		await expect.poll(async () => (await donationOf(bookingRef)).point_receipts?.length).toBe(1);

		await scanAt(page, bookingRef, GYM);
		await expect(page.getByTestId('scan-line-0')).toHaveAttribute('data-line-state', 'recorded');
		await page.getByTestId('close-donation-button').click();
		const dialog = page.getByTestId('close-donation-dialog');
		await expect(dialog).toContainText(needA.name);
		const closing = page.waitForResponse(
			(r) =>
				r.url().endsWith(`/api/back-office/donations/${bookingRef}/close`) &&
				r.request().method() === 'POST'
		);
		await dialog.getByTestId('close-donation-confirm').click();
		const res = await closing;
		expect(res.ok(), `close failed: ${await res.text()}`).toBe(true);

		await expect.poll(async () => (await donationOf(bookingRef)).status).toBe('received');
		const closed = await donationOf(bookingRef);
		expect(closed.received_summary).toMatchObject({ closed_reason: 'staff_close' });
		expect(closed.received_summary?.closed_by).toBe(ws.name);
		expect(closed.received_summary?.shortfalls).toEqual([
			expect.objectContaining({ item_id: needA.item_id, declared: '2', counted: '1', short: '1' })
		]);
		expect(await ledgerRowsFor(shelter.code, closed._id)).toHaveLength(1);

		const audit = await couchReq(
			'GET',
			`/${shelterDb(shelter.code)}/${encodeURIComponent(await deriveDonationCloseAuditId(closed._id))}`
		);
		expect(audit.status).toBe(200);
		expect(audit.data).toMatchObject({
			target_id: closed._id,
			context: { closed_reason: 'staff_close', unrecorded_lines: [1] }
		});
	});

	test('Z teardown leaves nothing of this run behind', async ({ request }) => {
		test.setTimeout(240_000);
		const run = await teardownRun(request, ledger);
		expect(run.shelters).toHaveLength(1);
		await expectRunGone(request, run);
	});
});
