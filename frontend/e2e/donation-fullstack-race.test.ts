import { test, expect, type Browser, type APIRequestContext } from '@playwright/test';
import { couchReq } from './helpers/couch';
import {
	RUN_ID,
	deleteDoc,
	fillBooking,
	freeEveningWindows,
	publicNeedsBoard,
	runDocs,
	shelterDb,
	skipUnlessFullStack,
	todayYmd,
	type BookingOptions,
	type BookingResponse,
	type PublicShelter,
	type SlotWindow
} from './helpers/donation-fullstack';

/**
 * Two donors pressing "ยืนยันการจองคิวบริจาค" at the same moment for the last spot,
 * against the REAL stack (no route mocks):
 *   PW_BASE_URL=http://localhost:5173 pnpm test:e2e e2e/donation-fullstack-race.test.ts
 *
 * Each donor gets their own browser context (own cookies/storage — two people, not two
 * tabs), is walked to the confirm button, and only then are both buttons pressed
 * together. Exactly one may win.
 *
 * The slot and the campaign the donors fight over are written straight into CouchDB
 * here: they are the setting, not the thing under test (the screens that create them
 * are covered in donation-fullstack-admin). Both are removed in afterAll; the bookings
 * stay.
 */

// No seeded campaign asks for it, so the board line this spec opens is the only one.
const RACE_ITEM = { id: 'item_master:egg', name: 'ไข่ไก่', unit: 'piece' };

let shelter: PublicShelter;
let pickup: SlotWindow;
const campaignId = `donation_campaign:e2e-race-${RUN_ID}`;

test.describe.configure({ mode: 'serial' });

async function boardLine(request: APIRequestContext) {
	const res = await request.get('/api/public/v1/needs');
	return ((await res.json()) as PublicShelter[])
		.find((s) => s.code === shelter.code)
		?.needs.find((n) => n.name === RACE_ITEM.name);
}

const SYNC = { timeout: 30_000 };

function stamp() {
	const now = new Date().toISOString();
	return { created_at: now, updated_at: now, created_by: 'e2e', schema_v: 1 };
}

test.beforeAll(async ({ request }) => {
	skipUnlessFullStack(test.skip);
	const board = await publicNeedsBoard(request);
	const pick = board.find((s) => !s.needs.some((n) => n.name === RACE_ITEM.name));
	test.skip(!pick, `every shelter already asks for ${RACE_ITEM.name}`);
	shelter = pick!;

	const [w] = await freeEveningWindows(shelter.code, 1);
	test.skip(!w, 'no free evening window left today');
	pickup = w;
});

test.afterAll(async ({ request }) => {
	if (!shelter) return;
	const db = shelterDb(shelter.code);
	// Close before deleting: the worker does not re-project needs on a campaign DELETE
	// (see donation-fullstack-admin), so a straight delete strands the board line.
	const camps = await runDocs(db, 'donation_campaign', 'notes');
	for (const c of camps) {
		await couchReq('PUT', `/${db}/${encodeURIComponent(c._id)}`, {
			...c,
			status: 'closed',
			visible_on_home: false
		});
	}
	if (camps.length) await expect.poll(() => boardLine(request), SYNC).toBeUndefined();
	for (const c of await runDocs(db, 'donation_campaign', 'notes')) await deleteDoc(db, c);
	for (const s of await runDocs(db, 'donation_slot', 'note')) await deleteDoc(db, s);
});

/**
 * Two donors, each in their own browser, walked to the confirm button; then both press
 * it in the same tick. Returns both answers in donor order.
 */
async function raceTwoDonors(
	browser: Browser,
	make: (who: 'A' | 'B') => BookingOptions
): Promise<BookingResponse[]> {
	const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
	try {
		const pages = await Promise.all(contexts.map((c) => c.newPage()));
		const donors = await Promise.all([
			fillBooking(pages[0], make('A')),
			fillBooking(pages[1], make('B'))
		]);
		return await Promise.all(donors.map((d) => d.submit()));
	} finally {
		await Promise.all(contexts.map((c) => c.close()));
	}
}

function errorCode(r: BookingResponse) {
	return typeof r.error === 'string' ? r.error : r.error?.code;
}

/** Outstanding bookings CouchDB holds for one pickup window today. */
async function bookingsInWindow(w: SlotWindow) {
	const res = await couchReq('POST', `/${shelterDb(shelter.code)}/_find`, {
		selector: {
			type: 'donation',
			'logistics.delivery_method': 'shelter_pickup',
			'logistics.slot.date': todayYmd(),
			'logistics.slot.from': w.from,
			status: { $nin: ['cancelled', 'rejected', 'expired', 'redirected'] }
		},
		fields: ['booking_ref'],
		limit: 10
	});
	return (res.data as { docs: { booking_ref: string }[] }).docs;
}

test('two donors race for the last pickup trip → only one gets it', async ({
	browser,
	request
}) => {
	// KNOWN BUG: both donors get the trip. The BFF counts bookings in CouchDB, but the
	// winner only reaches CouchDB after FastAPI → Mongo → sync worker, so for a few
	// seconds the loser's count cannot see it (`api/public/v1/donations/+server.ts`
	// reads at :78, re-checks at :101-122, writes via FastAPI at :128). Reproduced 3/3.
	// Expected to fail until fixed; Playwright flags it once it passes.
	test.fail();
	// Any open need at the shelter will do — the fight is over the truck, not the item.
	const need = (await publicNeedsBoard(request))
		.find((s) => s.code === shelter.code)!
		.needs.find((n) => n.status === 'open' && Number(n.qty_needed) >= 2);
	test.skip(!need, `${shelter.code} has no open need with room for two`);

	const db = shelterDb(shelter.code);
	const slotId = `donation_slot:pickup:${todayYmd()}:${pickup.from}`;
	await couchReq('PUT', `/${db}/${encodeURIComponent(slotId)}`, {
		_id: slotId,
		type: 'donation_slot',
		shelter_code: shelter.code,
		...stamp(),
		mode: 'pickup',
		date: todayYmd(),
		from: pickup.from,
		to: pickup.to,
		capacity: 1,
		status: 'open',
		note: `e2e race ${RUN_ID}`
	});

	const results = await raceTwoDonors(browser, (who) => ({
		shelter,
		need: need!,
		donorName: `E2E แย่งรถ ${who} ${RUN_ID}`,
		phone: who === 'A' ? '0861110001' : '0861110002',
		mode: {
			kind: 'pickup',
			address: `${who} 1/1 ถ.ทดสอบ (e2e ${RUN_ID})`,
			slot: new RegExp(`^${pickup.from} - ${pickup.to} ว่าง`)
		}
	}));

	const winners = results.filter((r) => r.success);
	const losers = results.filter((r) => !r.success);
	// What each side got, in the failure message — the point is to see the race.
	const summary = JSON.stringify(results);
	expect(winners, `both donors were answered: ${summary}`).toHaveLength(1);
	expect(losers.map(errorCode), summary).toEqual(['SLOT_FULL']);

	// And the truck really carries one job — checked once the winner has synced in.
	await expect.poll(async () => (await bookingsInWindow(pickup)).length, SYNC).toBeGreaterThan(0);
	expect(await bookingsInWindow(pickup)).toEqual([{ booking_ref: winners[0].bookingRef }]);
});

test('two donors race for the last unit of a need → only one is accepted', async ({
	browser,
	request
}) => {
	const db = shelterDb(shelter.code);
	await couchReq('PUT', `/${db}/${encodeURIComponent(campaignId)}`, {
		_id: campaignId,
		type: 'donation_campaign',
		shelter_code: shelter.code,
		...stamp(),
		schema_v: 3,
		title: RACE_ITEM.name,
		needs: [{ item_id: RACE_ITEM.id, qty_target: '1', unit: RACE_ITEM.unit, status: 'open' }],
		status: 'open',
		visible_on_home: true,
		urgency: 'critical',
		notes: `e2e race ${RUN_ID}`
	});
	await expect.poll(async () => Number((await boardLine(request))?.qty_needed), SYNC).toBe(1);

	const results = await raceTwoDonors(browser, (who) => ({
		shelter,
		need: { name: RACE_ITEM.name },
		donorName: `E2E แย่งไข่ ${who} ${RUN_ID}`,
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
		.poll(async () => (await boardLine(request))?.status ?? 'gone', SYNC)
		.not.toBe('open');
});
