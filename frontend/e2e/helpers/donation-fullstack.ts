import { expect, type APIRequestContext, type Page } from '@playwright/test';
import {
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	seedSecurityQuestion,
	type TestUser
} from './couch';
import { injectSession } from './login';

/**
 * Shared steps for the full-stack donation specs (`donation-fullstack*.test.ts`).
 *
 * Nothing here is route-mocked: the public wizard posts through the SvelteKit BFF to
 * FastAPI → Mongo → sync worker → CouchDB, and the back-office reads CouchDB. The
 * specs skip themselves unless `PW_BASE_URL` points at a running `pnpm dev` — the BFF
 * only skips reCAPTCHA in dev.
 */

export const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

export type PublicNeed = {
	item_id: string;
	name: string;
	status: string;
	qty_needed: string | number;
	urgency?: string;
};
export type PublicShelter = { code: string; name: string; needs: PublicNeed[] };

export type Staff = TestUser & { session: string };

export function skipUnlessFullStack(skip: (cond: boolean, why: string) => void) {
	skip(!process.env.PW_BASE_URL, 'full-stack only — set PW_BASE_URL to a running `pnpm dev`');
}

export async function publicNeedsBoard(request: APIRequestContext): Promise<PublicShelter[]> {
	const res = await request.get('/api/public/v1/needs');
	expect(res.ok(), `needs board unavailable (HTTP ${res.status()}) — is FastAPI up?`).toBe(true);
	return (await res.json()) as PublicShelter[];
}

/** First shelter with an open need that has room for a few qty-1 bookings. */
export function pickOpenNeed(board: PublicShelter[]) {
	for (const s of board) {
		const n = s.needs.find((x) => x.status === 'open' && Number(x.qty_needed) >= 5);
		if (n) return { shelter: s, need: n };
	}
	return null;
}

/**
 * Flat roles, like `pnpm seed` — the compound form gets past the route guard but not
 * past `catalog._security` (see stock-donations.test.ts).
 */
export async function createWarehouseStaff(shelterCode: string, tag: string): Promise<Staff> {
	const user: TestUser = {
		name: `dn_${tag}_${RUN_ID}`,
		password: 'Password1!',
		roles: [`shelter:${shelterCode}`, 'warehouse_staff'],
		display_name: `Donation E2E ${tag}`
	};
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return { ...user, session: await couchLogin(user.name, user.password) };
}

export async function deleteStaff(staff: Staff | undefined) {
	if (staff) await deleteCouchUser(staff.name);
}

export type DeliveryMode =
	| { kind: 'self' }
	| { kind: 'parcel'; trackingNo?: string }
	| { kind: 'pickup'; address: string; slot: RegExp };

export type Booking = { bookingRef: string; trackingToken: string };

/**
 * The innermost `div` holding both `text` and a button with `name`. The cards carry no
 * landmark, and `.first()` would be the outermost wrapper — which holds EVERY card, so
 * its first button belongs to whichever shelter/need happens to be listed first.
 */
function cardWith(page: Page, text: string, name: string) {
	const button = page.getByRole('button', { name });
	return page
		.locator('div')
		.filter({ hasText: text })
		.filter({ has: button })
		.last()
		.getByRole('button', { name });
}

/**
 * What the donor board prints for a need. The projection falls back to the raw item id
 * as `name` when the catalog has no doc for it — the staging seed still binds campaigns
 * to legacy `item:*` ids that the current catalog (`item_master:<ulid>`) no longer holds —
 * and the board then relabels those ids itself. Mirrors `formatItemName` in
 * `src/lib/components/public-donor-needs.svelte` (Thai); keep the two in step.
 */
const LEGACY_ITEM_LABELS: Record<string, string> = {
	'item:rice': 'ข้าวสาร (อาหารแห้ง)',
	'item:water': 'น้ำดื่มสะอาด',
	'item:soap': 'สบู่และของใช้ส่วนตัว',
	'item:blanket': 'ผ้าห่มกันหนาว',
	'item:paracetamol': 'ยาพาราเซตามอล (ยาสามัญ)',
	'item:canned_fish': 'ปลากระป๋อง',
	'item:instant_noodle': 'บะหมี่กึ่งสำเร็จรูป',
	'item:mosquito_net': 'มุ้งกันยุง',
	'item:sanitary_pad': 'ผ้าอนามัย'
};

export function needLabel(need: { name: string }): string {
	const label = LEGACY_ITEM_LABELS[need.name];
	if (label) return label;
	return need.name.startsWith('item:') ? need.name.slice('item:'.length) : need.name;
}

/** `item_master` id for a catalog name — ids are minted per seed (`item_master:<ulid>`). */
export async function catalogItem(name: string): Promise<{ id: string; unit: string }> {
	const res = await couchReq('POST', '/catalog/_find', {
		selector: { type: 'item_master', name },
		fields: ['_id', 'base_unit'],
		limit: 1
	});
	const doc = (res.data as { docs: { _id: string; base_unit: string }[] }).docs[0];
	expect(doc, `catalog has no item_master named ${name} — run \`pnpm seed\``).toBeTruthy();
	return { id: doc._id, unit: doc.base_unit };
}

/** Public needs board → `shelter`'s card → the line for `itemName` (as the board prints it). */
export async function openNeed(page: Page, shelter: PublicShelter, itemName: string) {
	await page.goto('/donations');
	await expect(page.getByRole('heading', { name: /กระดาน\s*ความต้องการด่วน/ })).toBeVisible();
	await cardWith(page, shelter.name, 'ดูรายละเอียดและบริจาค').click();
	await cardWith(page, itemName, 'บริจาครายการนี้').click();
}

export type BookingOptions = {
	shelter: PublicShelter;
	need: Pick<PublicNeed, 'name'>;
	donorName: string;
	phone: string;
	mode?: DeliveryMode;
};

export type BookingResponse = Partial<Booking> & {
	success: boolean;
	error?: string | { code: string; message: string };
};

/**
 * Walk the public wizard up to — not past — "ยืนยันการจองคิวบริจาค", qty 1.
 * Returns `submit`, which presses it and hands back the BFF's answer unasserted, so
 * two donors can be brought to the button first and made to press it together.
 */
export async function fillBooking(
	page: Page,
	opts: BookingOptions
): Promise<{ submit: () => Promise<BookingResponse> }> {
	const { shelter, need, donorName, phone } = opts;
	const mode = opts.mode ?? { kind: 'self' };

	await openNeed(page, shelter, needLabel(need));

	// Step 2 — donor + item. Name/unit come from the need; only the qty is ours.
	await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
	await page.locator('#donor-name').fill(donorName);
	await page.locator('#donor-phone').fill(phone);
	await expect(page.getByRole('textbox', { name: 'ประเภทสิ่งของ' })).toHaveValue(needLabel(need));
	await page.getByRole('spinbutton', { name: 'ปริมาณ' }).fill('1');
	await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();

	// Step 3 — logistics. The destination is locked to the card's shelter.
	await expect(
		page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
	).toBeVisible();
	await expect(page.getByText('ล็อกตามความต้องการที่เลือก')).toBeVisible();
	const button = page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' });

	if (mode.kind === 'self') {
		await page.getByRole('button', { name: 'นำมาส่งด้วยตนเอง' }).click();
		await page.getByRole('button', { name: 'รถยนต์' }).click();
		const freeSlot = page.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ }).first();
		await expect(freeSlot, `${shelter.code} has no free drop-off slot`).toBeVisible();
		await freeSlot.click();
	} else if (mode.kind === 'parcel') {
		await page.getByRole('button', { name: 'ส่งผ่านขนส่งพัสดุ' }).click();
		await expect(page.getByRole('heading', { name: 'ข้อมูลขนส่งพัสดุ' })).toBeVisible();
		if (mode.trackingNo) {
			await page.getByRole('textbox', { name: 'ระบุภายหลังได้' }).fill(mode.trackingNo);
		}
	} else {
		await page.getByRole('button', { name: /ต้องการให้รถศูนย์ไปรับ/ }).click();
		// Pickup is the one queue with a ceiling — no slot, no submit.
		await expect(button).toBeDisabled();
		await page.getByRole('textbox', { name: 'ที่อยู่เข้ารับของ *' }).fill(mode.address);
		await page.getByRole('button', { name: mode.slot }).click();
	}
	await expect(button).toBeEnabled();

	return {
		submit: async () => {
			const posted = page.waitForResponse(
				(r) => r.url().endsWith('/api/public/v1/donations') && r.request().method() === 'POST'
			);
			await button.click();
			return (await (await posted).json()) as BookingResponse;
		}
	};
}

/** Walk the public wizard for `need` at `shelter` with qty 1; asserts the ticket. */
export async function bookAsDonor(page: Page, opts: BookingOptions): Promise<Booking> {
	const { submit } = await fillBooking(page, opts);
	const body = await submit();
	// Under `vite preview` (not dev) with no reCAPTCHA keys the BFF fails closed with
	// SERVER_MISCONFIGURED — point PW_BASE_URL at `pnpm dev` instead. RATE_LIMITED is
	// FastAPI's 30 req/min/IP on every donation route: one run fits, two back to back
	// do not — wait a minute between runs.
	expect(body.success, `booking POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;

	// Step 4 — every public booking opens as pending_review (CR-052 §1.4).
	await expect(page.getByRole('heading', { name: 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' })).toBeVisible();
	await expect(page.getByText(bookingRef).first()).toBeVisible();
	return { bookingRef, trackingToken };
}

/** Open stock-donations as `staff`. */
export async function openBackOffice(page: Page, staff: Staff) {
	await injectSession(page, staff, staff.session);
	await page.goto('/back-office/stock-donations');
	await expect(page.getByRole('tab', { name: /รอการประเมิน/ })).toBeVisible({ timeout: 15_000 });
}

/**
 * The booking reaches CouchDB through the sync worker, so it can trail the ticket by a
 * few seconds. The queue loads once at mount — reload until the row is there.
 */
export async function openPendingRow(page: Page, bookingRef: string) {
	const row = page.getByRole('row').filter({ hasText: bookingRef });
	await expect(async () => {
		await page.reload();
		await page.getByRole('tab', { name: /รอการประเมิน/ }).click();
		await expect(row).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	await row.getByRole('button', { name: 'จัดการ' }).click();
	await expect(page.getByRole('heading', { name: new RegExp(`^${bookingRef} - `) })).toBeVisible();
}

/** Approve from the pending tab and wait for CouchDB to flip to `verifying`. */
export async function approvePending(page: Page, shelterCode: string, bookingRef: string) {
	await openPendingRow(page, bookingRef);
	await page.getByRole('textbox', { name: /Internal Review Memo/ }).fill(`e2e ${RUN_ID}`);
	await page.getByRole('button', { name: 'อนุมัติรับ (Generate QR)' }).click();
	await expect(page.getByText(`อนุมัติคำขอ ${bookingRef} เข้าสู่การตรวจรับแล้ว`)).toBeVisible();
	await expect
		.poll(async () => (await findDonation(shelterCode, bookingRef))?.status)
		.toBe('verifying');
}

/** Open a booking in the scan station by typing its ref. */
export async function openInScanStation(page: Page, bookingRef: string) {
	await page.reload();
	await page.getByRole('textbox', { name: 'รหัสการจอง' }).fill(bookingRef);
	await page.getByRole('button', { name: 'ค้นหา' }).click();
	await expect(
		page.getByRole('heading', { name: `${bookingRef} - ตรวจรับพัสดุบริจาค (Verifying Drop-off)` })
	).toBeVisible();
}

export function shelterDb(shelterCode: string) {
	return `shelter_${shelterCode.toLowerCase()}`;
}

export async function findDonation(shelterCode: string, bookingRef: string) {
	const res = await couchReq('POST', `/${shelterDb(shelterCode)}/_find`, {
		selector: { type: 'donation', booking_ref: bookingRef },
		limit: 1
	});
	return (res.data as { docs: Record<string, unknown>[] }).docs[0];
}

export async function ledgerRowsFor(shelterCode: string, donationId: string) {
	const res = await couchReq('POST', `/${shelterDb(shelterCode)}/_find`, {
		selector: { type: 'stock_ledger', reason: 'donation', ref_id: donationId },
		limit: 10
	});
	return (res.data as { docs: { item_id: string; qty: string }[] }).docs;
}

/** Every doc of `type` in `db` whose `field` carries this run's id. */
export async function runDocs(db: string, type: string, field: string) {
	const res = await couchReq('POST', `/${db}/_find`, {
		selector: { type, [field]: { $regex: RUN_ID } },
		limit: 50
	});
	return (res.data as { docs: ({ _id: string; _rev: string } & Record<string, unknown>)[] }).docs;
}

export async function deleteDoc(db: string, d: { _id: string; _rev: string }) {
	await couchReq('DELETE', `/${db}/${encodeURIComponent(d._id)}?rev=${d._rev}`);
}

export type SlotWindow = { from: string; to: string };

/** Local YYYY-MM-DD — the wizard and the slot screen both default to it. */
export function todayYmd() {
	return new Date().toLocaleDateString('sv-SE');
}

/**
 * A slot counts every outstanding booking with the same date + `from`, whichever run
 * made it — so a fixed window would already be "full" from the last run's booking.
 * Returns up to `n` 20-minute evening windows no booking and no slot of today uses.
 */
export async function freeEveningWindows(shelterCode: string, n: number): Promise<SlotWindow[]> {
	const today = todayYmd();
	const res = await couchReq('POST', `/${shelterDb(shelterCode)}/_find`, {
		selector: {
			$or: [
				{ type: 'donation', 'logistics.slot.date': today },
				{ type: 'donation_slot', date: today }
			]
		},
		limit: 5000
	});
	const taken = new Set(
		(res.data as { docs: Record<string, unknown>[] }).docs.map((d) =>
			d.type === 'donation_slot'
				? (d.from as string)
				: (d.logistics as { slot: { from: string } }).slot.from
		)
	);
	const hhmm = (x: number) =>
		`${String(Math.floor(x / 60)).padStart(2, '0')}:${String(x % 60).padStart(2, '0')}`;
	const free: SlotWindow[] = [];
	for (let m = 18 * 60; m + 20 < 24 * 60 && free.length < n; m += 5) {
		if (!taken.has(hhmm(m))) free.push({ from: hhmm(m), to: hhmm(m + 20) });
	}
	return free;
}

/** The public board's line for `itemName` at `shelterCode`, if any. */
export async function boardLineFor(
	request: APIRequestContext,
	shelterCode: string,
	itemName: string
): Promise<PublicNeed | undefined> {
	const res = await request.get('/api/public/v1/needs');
	if (!res.ok()) return undefined;
	return ((await res.json()) as PublicShelter[])
		.find((s) => s.code === shelterCode)
		?.needs.find((n) => n.name === itemName);
}

// Campaigns reach the public board through the worker's Mongo projection.
export const BOARD_SYNC = { timeout: 30_000 };

/**
 * Open a campaign of this run's own for `itemName` at `shelterCode`, straight into
 * CouchDB, and wait for it on the public board. Seeded campaigns bind legacy `item:*`
 * ids the current catalog no longer holds, so their donations cannot be received into
 * stock (CATALOG_MISMATCH); a campaign on a real `item_master` id can.
 */
export async function openRunCampaign(
	request: APIRequestContext,
	shelterCode: string,
	itemName: string,
	qtyTarget: number,
	tag: string
): Promise<PublicNeed> {
	const item = await catalogItem(itemName);
	const id = `donation_campaign:e2e-${tag}-${RUN_ID}`;
	const now = new Date().toISOString();
	await couchReq('PUT', `/${shelterDb(shelterCode)}/${encodeURIComponent(id)}`, {
		_id: id,
		type: 'donation_campaign',
		schema_v: 3,
		shelter_code: shelterCode,
		created_at: now,
		updated_at: now,
		created_by: 'e2e',
		title: itemName,
		needs: [{ item_id: item.id, qty_target: String(qtyTarget), unit: item.unit, status: 'open' }],
		status: 'open',
		visible_on_home: true,
		urgency: 'normal',
		notes: `e2e ${tag} ${RUN_ID}`
	});
	await expect
		.poll(async () => (await boardLineFor(request, shelterCode, itemName))?.status, BOARD_SYNC)
		.toBe('open');
	return (await boardLineFor(request, shelterCode, itemName))!;
}

/**
 * Close + hide this run's campaigns at `shelterCode`, wait until `itemName` has left the
 * board, then delete them. The worker does not re-project needs on a campaign DELETE, so
 * a straight delete would strand the line on the public board.
 */
export async function retireRunCampaigns(
	request: APIRequestContext,
	shelterCode: string,
	itemName: string
) {
	const db = shelterDb(shelterCode);
	const camps = await runDocs(db, 'donation_campaign', 'notes');
	for (const c of camps) {
		await couchReq('PUT', `/${db}/${encodeURIComponent(c._id)}`, {
			...c,
			status: 'closed',
			visible_on_home: false
		});
	}
	if (camps.length) {
		await expect
			.poll(async () => await boardLineFor(request, shelterCode, itemName), BOARD_SYNC)
			.toBeUndefined();
	}
	for (const c of await runDocs(db, 'donation_campaign', 'notes')) await deleteDoc(db, c);
}
