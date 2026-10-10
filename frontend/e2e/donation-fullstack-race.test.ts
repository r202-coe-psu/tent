import { test, expect, type Browser } from '@playwright/test';
import { couchReq } from './helpers/couch';
import { CAN_WRITE, READ_ONLY_REASON } from './helpers/e2e-env';
import {
	BOARD_SYNC,
	RUN_ID,
	RunLedger,
	addSlotViaUi,
	bookingPacer,
	boardLineFor,
	createCampaignViaUi,
	createWarehouseStaff,
	expectRunGone,
	fillBooking,
	openSlots,
	provisionShelter,
	shelterDb,
	suspendRecaptcha,
	teardownRun,
	todayYmd,
	type BookingOptions,
	type BookingResponse,
	type PublicNeed,
	type PublicShelter,
	type SlotMode,
	type SlotWindow,
	type Staff
} from './helpers/donation-fullstack';

/**
 * Two donors pressing "ยืนยันการจองคิวบริจาค" at the same moment for the last spot,
 * against the REAL stack (no route mocks), on this run's own `E2E Donation race …`
 * shelter (README §4).
 *
 * Needs `docker compose up -d` (CouchDB, Mongo, worker, FastAPI) and a seeded catalog
 * (`pnpm seed`). Locally use the dev server — only it skips reCAPTCHA keys / the BFF's
 * per-IP rate limits (on `vite preview` also set DONATION_E2E_PACE=1):
 *   PLAYWRIGHT_TEST_BASE_URL=http://localhost:5173 \
 *     pnpm exec playwright test e2e/donation-fullstack-race.test.ts
 * On a writable remote target (`E2E_BASE_URL` + `ALLOW_REMOTE_WRITES=true`, i.e. staging)
 * it runs like any `@critical` suite; read-only targets skip it.
 *
 * Each donor gets their own browser context (own cookies/storage — two people, not two
 * tabs), is walked to the confirm button, and only then are both buttons pressed
 * together. Exactly one may win. The slots (capacity 1) and the campaigns the donors
 * fight over are set up through the back-office screens like any other setup; the only
 * thing not driven through a UI is the race itself — two simultaneous presses, which no
 * single-user flow can express.
 *
 * Teardown (`teardownRun`, ids from the per-run ledger only): cancel each winner's
 * booking as its donor would (which releases the trip / unit), delete the shelter (its
 * campaigns and slots go with its database) and the staff user; the last test (Z)
 * asserts nothing is left. Residue the test side cannot remove: the Mongo intake-buffer /
 * `public_donations` rows of the winning bookings (retention purges them on its TTL) and
 * the closed `public_shelters` row (dropped by the worker within minutes). Every attempt
 * counts against the BFF's 3 bookings/min/IP, so the three races pace themselves on a
 * remote target and the suite takes several minutes there.
 */

// Open need with room for both donors of the two slot races — the fight is over the
// truck / the window, not the item.
const ROOM_ITEM = 'ยาสีฟัน';
// A campaign exactly one unit short: only one of two donors can take it.
const RACE_ITEM = 'แปรงสีฟัน';

const ledger = new RunLedger('donation-fullstack-race');
let shelter: PublicShelter;
let roomNeed: PublicNeed;
let staff: Staff;
let restoreRecaptcha: (() => Promise<void>) | undefined;

const SYNC = BOARD_SYNC;

/** A fresh shelter has no booking and no slot, so fixed evening windows are always free. */
const PICKUP: SlotWindow = { from: '18:00', to: '18:20' };
const DROPOFF: SlotWindow = { from: '18:30', to: '18:50' };

/** Staff add one queue window of capacity 1 today through the slots manager. */
async function openCappedWindow(browser: Browser, mode: SlotMode, w: SlotWindow) {
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await openSlots(page, staff, mode);
		const row = await addSlotViaUi(page, w, 1, `e2e race ${RUN_ID}`);
		await expect(row).toContainText('จองแล้ว 0 / 1');
	} finally {
		await context.close();
	}
}

test.describe('Donation full-stack: booking races', { tag: ['@critical', '@donation'] }, () => {
	test.describe.configure({ mode: 'serial', timeout: 240_000 });

	test.beforeAll(async ({ request, browser }) => {
		test.skip(!CAN_WRITE, READ_ONLY_REASON);
		test.setTimeout(360_000);
		restoreRecaptcha = await suspendRecaptcha(browser);
		const created = await provisionShelter(browser, ledger, 'race');
		staff = await createWarehouseStaff(ledger, created.code, 'race');

		const context = await browser.newContext();
		try {
			roomNeed = await createCampaignViaUi(await context.newPage(), request, staff, created.code, {
				item: ROOM_ITEM,
				target: 20,
				notes: `e2e race room ${RUN_ID}`
			});
		} finally {
			await context.close();
		}
		shelter = { ...created, needs: [roomNeed] };
	});

	test.afterAll(async ({ request }) => {
		if (!CAN_WRITE) return;
		test.setTimeout(240_000);
		await restoreRecaptcha?.();
		await teardownRun(request, ledger);
	});

	/**
	 * Two donors, each in their own browser, walked to the confirm button; then both press
	 * it in the same tick. Returns both answers in donor order.
	 */
	async function raceTwoDonors(
		browser: Browser,
		make: (who: 'A' | 'B') => Omit<BookingOptions, 'ledger'>
	): Promise<BookingResponse[]> {
		const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
		try {
			const pages = await Promise.all(contexts.map((c) => c.newPage()));
			const donors = await Promise.all([
				fillBooking(pages[0], { ...make('A'), ledger }),
				fillBooking(pages[1], { ...make('B'), ledger })
			]);
			// Both presses count against the BFF's per-IP limit: make room for the pair, then
			// fire them together (a paced submit each would serialise them).
			await bookingPacer.acquire(2);
			return await Promise.all(donors.map((d) => d.submit({ paced: false })));
		} finally {
			await Promise.all(contexts.map((c) => c.close()));
		}
	}

	function errorCode(r: BookingResponse) {
		return typeof r.error === 'string' ? r.error : r.error?.code;
	}

	/** Outstanding bookings CouchDB holds for one window of one queue today. */
	async function bookingsInWindow(
		w: SlotWindow,
		method: 'shelter_pickup' | 'self_dropoff' = 'shelter_pickup'
	) {
		const res = await couchReq('POST', `/${shelterDb(shelter.code)}/_find`, {
			selector: {
				type: 'donation',
				'logistics.delivery_method': method,
				'logistics.slot.date': todayYmd(),
				'logistics.slot.from': w.from,
				status: { $nin: ['cancelled', 'rejected', 'expired', 'redirected'] }
			},
			fields: ['booking_ref'],
			limit: 10
		});
		return (res.data as { docs: { booking_ref: string }[] }).docs;
	}

	test('two donors race for the last pickup trip → only one gets it', async ({ browser }) => {
		// The BFF's CouchDB count cannot see the winner for a few seconds — it reaches
		// CouchDB only after FastAPI → Mongo → sync worker — so both donors pass it. The
		// place is decided by FastAPI's slot counter (`slot_hold`), which sees both.
		await openCappedWindow(browser, 'รถศูนย์ไปรับ', PICKUP);

		const results = await raceTwoDonors(browser, (who) => ({
			shelter,
			need: roomNeed,
			donorName: `E2E แย่งรถ ${who} ${RUN_ID}`,
			phone: who === 'A' ? '0861110001' : '0861110002',
			mode: {
				kind: 'pickup',
				address: `${who} 1/1 ถ.ทดสอบ (e2e ${RUN_ID})`,
				slot: new RegExp(`^${PICKUP.from} - ${PICKUP.to} ว่าง`)
			}
		}));

		const winners = results.filter((r) => r.success);
		const losers = results.filter((r) => !r.success);
		// What each side got, in the failure message — the point is to see the race.
		const summary = JSON.stringify(results);
		expect(winners, `both donors were answered: ${summary}`).toHaveLength(1);
		expect(losers.map(errorCode), summary).toEqual(['SLOT_FULL']);

		// And the truck really carries one job — checked once the winner has synced in.
		await expect.poll(async () => (await bookingsInWindow(PICKUP)).length, SYNC).toBeGreaterThan(0);
		expect(await bookingsInWindow(PICKUP)).toEqual([{ booking_ref: winners[0].bookingRef }]);
	});

	test('two donors race for the last place in a capped drop-off window → only one gets it', async ({
		browser
	}) => {
		// Drop-off windows are normally uncapped, but staff may put a ceiling on a busy one
		// (the slot screen's "จำกัดจำนวนคิว"). That ceiling goes through the same BFF
		// count as the pickup trip above, so it is held by the same FastAPI slot counter.
		await openCappedWindow(browser, 'ผู้บริจาคมาส่งเอง', DROPOFF);

		const results = await raceTwoDonors(browser, (who) => ({
			shelter,
			need: roomNeed,
			donorName: `E2E แย่งคิวมาส่ง ${who} ${RUN_ID}`,
			phone: who === 'A' ? '0863330001' : '0863330002',
			mode: { kind: 'self', slot: new RegExp(`^${DROPOFF.from} - ${DROPOFF.to} ว่าง`) }
		}));

		const winners = results.filter((r) => r.success);
		const losers = results.filter((r) => !r.success);
		const summary = JSON.stringify(results);
		expect(winners, `both donors were answered: ${summary}`).toHaveLength(1);
		expect(losers.map(errorCode), summary).toEqual(['SLOT_FULL']);

		await expect
			.poll(async () => (await bookingsInWindow(DROPOFF, 'self_dropoff')).length, SYNC)
			.toBeGreaterThan(0);
		expect(await bookingsInWindow(DROPOFF, 'self_dropoff')).toEqual([
			{ booking_ref: winners[0].bookingRef }
		]);
	});

	test('two donors race for the last unit of a need → only one is accepted', async ({
		browser,
		request
	}) => {
		// Exactly one unit short, on a shelf that holds none of it.
		const context = await browser.newContext();
		try {
			const line = await createCampaignViaUi(
				await context.newPage(),
				request,
				staff,
				shelter.code,
				{ item: RACE_ITEM, target: 1, notes: `e2e race unit ${RUN_ID}` }
			);
			expect(Number(line.qty_needed)).toBe(1);
		} finally {
			await context.close();
		}

		const results = await raceTwoDonors(browser, (who) => ({
			shelter,
			need: { name: RACE_ITEM },
			donorName: `E2E แย่งแปรง ${who} ${RUN_ID}`,
			phone: who === 'A' ? '0862220001' : '0862220002'
		}));

		const summary = JSON.stringify(results);
		expect(
			results.filter((r) => r.success),
			`both donors were answered: ${summary}`
		).toHaveLength(1);
		expect(results.filter((r) => !r.success).map(errorCode), summary).toEqual(['NEED_FULL']);

		// Filled — the board stops offering it.
		await expect
			.poll(
				async () => (await boardLineFor(request, shelter.code, RACE_ITEM))?.status ?? 'gone',
				SYNC
			)
			.not.toBe('open');
	});

	test('Z teardown leaves nothing of this run behind', async ({ request }) => {
		test.setTimeout(240_000);
		const run = await teardownRun(request, ledger);
		expect(run.shelters).toHaveLength(1);
		await expectRunGone(request, run);
	});
});
