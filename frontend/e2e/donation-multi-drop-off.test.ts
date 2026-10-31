import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
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
	fillBooking,
	expectRunGone,
	findDonation,
	ledgerRowsFor,
	openBackOffice,
	openInScanStation,
	openPendingRow,
	provisionShelter,
	publicNeedsBoard,
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
	approveWithPoints,
	bookSelfDropoffViaApi,
	bookTypedAsDonor,
	reviewLine,
	setDonationPoints,
	type BookingLine,
	type DonationPointSeed
} from './helpers/donation-points';
import { deriveDonationCloseAuditId } from '../src/lib/features/operations/domain/donation-batch';

/**
 * CR-206 with Amendment A2 — one booking split across a shelter's drop-off points, against
 * the REAL stack (no route mocks), on this run's own `E2E Donation points …` shelter
 * (README §4).
 *
 * The shelter gets two drop-off points ("โรงยิม", "ห้องพยาบาล") straight on its registry
 * master (`setDonationPoints`). Staff, not the donor, decide where each line goes: the
 * campaign need carries the gym (FR-AP-1), so a campaign line is booked to it, and a line
 * of the donor's own waits for staff to give it a point at review (FR-AP-17). Neither item
 * has a `shelf_life_days`, so the scan station receives them without an expiry.
 *
 * Teardown (`teardownRun`) cancels what is still open; a booking some point already
 * received answers 409 GOODS_IN_STOCK, which is why every booking this spec leaves open is
 * closed by the test itself.
 */

const ITEM_A = 'แปรงสีฟัน';
/** In the catalog, not in the campaign: a line of the donor's own (staff-assigned drop-off). */
const ITEM_B = 'ผ้าห่มกันหนาว';
const AWAITING_GROUP = '?staff';

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
let mixedLines: BookingLine[];
let restoreRecaptcha: (() => Promise<void>) | undefined;

// Booked in AC-AP-13 and carried through AC-5, AC-9 and AC-6.
let main: Booking;

type DonationDoc = {
	_id: string;
	status: string;
	items: { drop_off_point_id?: string | null; review_status?: string }[];
	point_receipts?: { point_id: string | null; line_nos: number[] }[];
	received_summary?: {
		items: unknown[];
		shortfalls: { item_id: string; declared: string; counted: string; short: string }[];
		closed_reason?: string;
		closed_by?: string;
	};
};

const donationOf = async (ref: string) => (await findDonation(shelter.code, ref)) as DonationDoc;

/**
 * A campaign line (booked to the gym by its need) and a line of the donor's own, then staff
 * send the donor's line to the clinic: the booking every receiving case starts from.
 */
async function bookSplitAcrossPoints(
	page: Page,
	request: APIRequestContext,
	donorName: string,
	phone: string
): Promise<Booking> {
	const booking = await bookSelfDropoffViaApi(request, {
		shelter,
		lines: mixedLines,
		donorName,
		phone,
		ledger
	});
	await expect
		.poll(async () => (await findDonation(shelter.code, booking.bookingRef))?.status, {
			timeout: 30_000
		})
		.toBe('pending_review');
	await openBackOffice(page, ws);
	await approveWithPoints(page, booking.bookingRef, [{ line: ITEM_B, pointName: CLINIC.name }]);
	await expectReadyForDropoff(shelter.code, booking.bookingRef);
	return booking;
}

async function reviewAudit(donationId: string) {
	const res = await couchReq('POST', `/${shelterDb(shelter.code)}/_find`, {
		selector: { type: 'audit', target_id: donationId, action: 'manual_adjust' },
		limit: 5
	});
	const docs = (res.data as { docs: { context?: { lines?: unknown[] } }[] }).docs;
	return docs.find((doc) => doc.context?.lines);
}

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

test.describe('Donation multi drop-off points (CR-206, A2)', { tag: ['@donation'] }, () => {
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
				notes: `e2e points ${RUN_ID}`,
				pointName: GYM.name
			});
		} finally {
			await context.close();
		}
		const itemA = await catalogItem(ITEM_A);
		const itemB = await catalogItem(ITEM_B);
		mixedLines = [
			{ item_id: needA.item_id, name: needA.name, unit: itemA.unit },
			{ item_id: itemB.id, name: ITEM_B, unit: itemB.unit }
		];
		shelter = { ...created, needs: [needA] };
	});

	test.afterAll(async ({ request }) => {
		if (!CAN_WRITE) return;
		test.setTimeout(240_000);
		await restoreRecaptcha?.();
		await teardownRun(request, ledger);
	});

	test('AC-AP-3: a campaign line is booked to the point its need names; the donor picks none', async ({
		page
	}) => {
		const campaigns = await couchReq('POST', `/${shelterDb(shelter.code)}/_find`, {
			selector: { type: 'donation_campaign', 'needs.0.item_id': needA.item_id },
			limit: 1
		});
		expect(
			(campaigns.data as { docs: { schema_v: number; needs: unknown[] }[] }).docs[0]
		).toMatchObject({
			schema_v: 4,
			needs: [expect.objectContaining({ drop_off_point_id: GYM.id })]
		});

		const { submit } = await fillBooking(page, {
			shelter,
			need: needA,
			donorName: `E2E จุดจากแคมเปญ ${RUN_ID}`,
			phone: '0867770030',
			ledger
		});
		// Step 3 shows, read-only, the point the card named (FR-AP-12); the donor picks none.
		await expect(page.getByTestId('drop-off-group')).toHaveCount(1);
		await expect(groupOf(page, GYM)).toContainText(needA.name);
		await expect(page.locator('[data-slot="select-trigger"]')).toHaveCount(0);
		const body = await submit();
		expect(body.success, `booking POST failed: ${JSON.stringify(body)}`).toBe(true);
		expect(body.status).toBe('verifying');
		expect(body.items).toEqual([{ drop_off_point_id: GYM.id, review_status: 'approved' }]);

		await expect(page.getByRole('heading', { name: 'สำเร็จ! ตั๋วบริจาคของคุณ' })).toBeVisible();
		await expect(page.getByTestId('drop-off-group')).toHaveCount(1);
		await expect(groupOf(page, GYM)).toContainText(needA.name);

		await expectReadyForDropoff(shelter.code, body.bookingRef!);
		const booked = await donationOf(body.bookingRef!);
		expect(booked.items.map((i) => i.drop_off_point_id)).toEqual([GYM.id]);
	});

	test('AC-AP-9, AC-AP-10: typed lines wait for staff, who send each to its own point', async ({
		page
	}) => {
		const typedA = `น้ำดื่ม e2e ${RUN_ID}`;
		const typedB = `ยาสามัญ e2e ${RUN_ID}`;
		const booking = await bookTypedAsDonor(page, {
			shelter,
			itemNames: [typedA, typedB],
			donorName: `E2E รอเจ้าหน้าที่ ${RUN_ID}`,
			phone: '0867770031',
			ledger
		});
		expect(booking.items).toEqual([
			{ drop_off_point_id: null, review_status: 'pending' },
			{ drop_off_point_id: null, review_status: 'pending' }
		]);
		const ticketGroup = page.getByTestId('drop-off-group');
		await expect(ticketGroup).toHaveCount(1);
		await expect(ticketGroup).toHaveAttribute('data-point-id', AWAITING_GROUP);
		await expect(ticketGroup).toContainText('รอเจ้าหน้าที่กำหนดจุดส่ง');
		await expect(ticketGroup.getByTestId('drop-off-group-awaiting-note')).toHaveText(
			'ถ้านำของมาก่อนเจ้าหน้าที่ประเมิน ส่งที่จุดรับบริจาคไหนของศูนย์ก็ได้'
		);
		await expect(ticketGroup).toContainText(typedA);
		await expect(ticketGroup).toContainText(typedB);
		await expect(ticketGroup.getByTestId('drop-off-group-status')).toHaveCount(0);

		await expect
			.poll(async () => (await findDonation(shelter.code, booking.bookingRef))?.status, {
				timeout: 30_000
			})
			.toBe('pending_review');
		expect(
			(await donationOf(booking.bookingRef)).items.map((i) => i.drop_off_point_id ?? null)
		).toEqual([null, null]);

		await trackPage(page, booking.trackingToken);
		const awaiting = page.locator(
			`[data-testid="drop-off-group"][data-point-id="${AWAITING_GROUP}"]`
		);
		await expect(page.getByTestId('drop-off-group')).toHaveCount(1);
		await expect(awaiting.getByTestId('drop-off-group-awaiting-note')).toBeVisible();
		await expect(awaiting).toContainText(typedA);
		await expect(awaiting).toContainText(typedB);

		await openBackOffice(page, ws);
		await approveWithPoints(page, booking.bookingRef, [
			{ line: typedA, pointName: GYM.name },
			{ line: typedB, pointName: CLINIC.name }
		]);
		await expectReadyForDropoff(shelter.code, booking.bookingRef);
		const reviewed = await donationOf(booking.bookingRef);
		expect(reviewed.items.map((i) => [i.review_status, i.drop_off_point_id])).toEqual([
			['approved', GYM.id],
			['approved', CLINIC.id]
		]);
		expect((await reviewAudit(reviewed._id))?.context?.lines).toEqual([
			expect.objectContaining({ index: 0, decision: 'approved', drop_off_point_id: GYM.id }),
			expect.objectContaining({ index: 1, decision: 'approved', drop_off_point_id: CLINIC.id })
		]);

		await trackPage(page, booking.trackingToken);
		await reloadUntilVisible(page, groupOf(page, GYM));
		await expect(page.getByTestId('drop-off-group')).toHaveCount(2);
		await expect(groupOf(page, GYM)).toContainText(typedA);
		await expect(groupOf(page, CLINIC)).toContainText(typedB);
		await expect(page.getByTestId('drop-off-group-status')).toHaveText(['รอรับ', 'รอรับ']);
	});

	test('AC-AP-13: a mixed booking keeps the campaign point; staff give the other line one', async ({
		page,
		request
	}) => {
		const booking = await bookSelfDropoffViaApi(request, {
			shelter,
			lines: mixedLines,
			donorName: `E2E รับทีละจุด ${RUN_ID}`,
			phone: '0867770032',
			ledger
		});
		expect(booking.items).toEqual([
			{ drop_off_point_id: GYM.id, review_status: 'approved' },
			{ drop_off_point_id: null, review_status: 'pending' }
		]);
		main = booking;

		await trackPage(page, main.trackingToken);
		await reloadUntilVisible(page, groupOf(page, GYM));
		await expect(page.getByTestId('drop-off-group')).toHaveCount(2);
		await expect(page.getByTestId('drop-off-group').first()).toHaveAttribute(
			'data-point-id',
			GYM.id
		);
		await expect(page.getByTestId('drop-off-group').last()).toHaveAttribute(
			'data-point-id',
			AWAITING_GROUP
		);
		await expect(groupOf(page, GYM)).toContainText(needA.name);
		await expect(page.getByTestId('drop-off-group').last()).toContainText(ITEM_B);

		await openBackOffice(page, ws);
		await expect
			.poll(async () => (await donationOf(main.bookingRef))?.status, { timeout: 30_000 })
			.toBe('pending_review');
		await openPendingRow(page, main.bookingRef);
		// The campaign line is not reviewed: its point shows, read-only, and only the line of
		// the donor's own takes a decision and a point.
		await expect(page.getByTestId('review-line-0-point')).toContainText(GYM.name);
		await expect(page.getByRole('group', { name: /^ผลการประเมิน/ })).toHaveCount(1);
		await expect(reviewLine(page, ITEM_B)).toBeVisible();

		await approveWithPoints(page, main.bookingRef, [{ line: ITEM_B, pointName: CLINIC.name }]);
		await expectReadyForDropoff(shelter.code, main.bookingRef);
		expect((await donationOf(main.bookingRef)).items.map((i) => i.drop_off_point_id)).toEqual([
			GYM.id,
			CLINIC.id
		]);
	});

	test('AC-5: staff at the gym receive only the gym line; the clinic line waits (FR-MP-18, 19, 20)', async ({
		page
	}) => {
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
		const { bookingRef } = await bookSplitAcrossPoints(
			page,
			request,
			`E2E ปิดใบ ${RUN_ID}`,
			'0867770033'
		);

		await scanAt(page, bookingRef, GYM);
		await expect(page.getByTestId('close-donation-button')).toHaveCount(0);
		await receiveLine(page, bookingRef, 0);
		await expect.poll(async () => (await donationOf(bookingRef)).point_receipts?.length).toBe(1);

		await scanAt(page, bookingRef, GYM);
		await expect(page.getByTestId('scan-line-0')).toHaveAttribute('data-line-state', 'recorded');
		await page.getByTestId('close-donation-button').click();
		const dialog = page.getByTestId('close-donation-dialog');
		await expect(dialog).toContainText(ITEM_B);
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
			expect.objectContaining({
				item_id: mixedLines[1].item_id,
				declared: '1',
				counted: '0',
				short: '1'
			})
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

	// Last of the bookings: a second campaign for the same item changes which campaign an
	// API booking without a card picks, so it must not exist while the cases above run.
	test('AC-AP-4: two campaigns ask for one item at different points; the card picked decides', async ({
		page,
		request
	}) => {
		const needClinic = await createCampaignViaUi(page, request, ws, shelter.code, {
			item: ITEM_A,
			target: 30,
			notes: `e2e points clinic ${RUN_ID}`,
			pointName: CLINIC.name
		});
		await clearSession(page);

		// One board row per item + point (FR-AP-25, FR-AP-26).
		const rows = (await publicNeedsBoard(request))
			.find((s) => s.code === shelter.code)!
			.needs.filter((n) => n.item_id === needA.item_id);
		expect(rows.map((n) => n.drop_off_point_id).sort()).toEqual([CLINIC.id, GYM.id].sort());
		expect(needClinic).toMatchObject({
			drop_off_point_id: CLINIC.id,
			drop_off_point_name: CLINIC.name
		});

		const { submit } = await fillBooking(page, {
			shelter,
			need: needClinic,
			donorName: `E2E การ์ดห้องพยาบาล ${RUN_ID}`,
			phone: '0867770034',
			ledger
		});
		await expect(page.getByTestId('drop-off-group')).toHaveCount(1);
		await expect(groupOf(page, CLINIC)).toContainText(needClinic.name);
		const body = await submit();
		expect(body.success, `booking POST failed: ${JSON.stringify(body)}`).toBe(true);
		expect(body.items).toEqual([{ drop_off_point_id: CLINIC.id, review_status: 'approved' }]);

		await expectReadyForDropoff(shelter.code, body.bookingRef!);
		const booked = (await findDonation(shelter.code, body.bookingRef!)) as DonationDoc & {
			campaign_id?: string;
		};
		expect(booked.items.map((i) => i.drop_off_point_id)).toEqual([CLINIC.id]);
		const campaign = await couchReq(
			'GET',
			`/${shelterDb(shelter.code)}/${encodeURIComponent(booked.campaign_id!)}`
		);
		expect(
			(campaign.data as { needs: { drop_off_point_id?: string }[] }).needs[0].drop_off_point_id
		).toBe(CLINIC.id);
	});

	test('Z teardown leaves nothing of this run behind', async ({ request }) => {
		test.setTimeout(240_000);
		const run = await teardownRun(request, ledger);
		expect(run.shelters).toHaveLength(1);
		await expectRunGone(request, run);
	});
});
