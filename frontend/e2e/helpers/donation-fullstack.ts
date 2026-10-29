import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
	expect,
	type APIRequestContext,
	type Browser,
	type Locator,
	type Page
} from '@playwright/test';
import {
	bootstrapAdminSession,
	createCouchUser,
	deleteCouchUser,
	couchLogin,
	couchReq,
	seedSecurityQuestion,
	SA_ROLES,
	type TestUser
} from './couch';
import { bangkokToday } from '../../src/lib/utils/date';
import { injectSession, routeBrowserCouchThroughApp } from './login';
import { publicShelter, teardownShelter, waitForProjection } from './public-cleanup';
import { createShelterViaUi, pinActiveShelter, setRecaptcha } from './staff-ui';

/**
 * Shared steps for the full-stack donation specs (`donation-fullstack*.test.ts`,
 * `stock-donations.test.ts`).
 *
 * Nothing here is route-mocked: the public wizard posts through the SvelteKit BFF to
 * FastAPI → Mongo → sync worker → CouchDB, and the back-office reads CouchDB. Each spec
 * follows e2e/README.md §4:
 *   - it works on its OWN `E2E …` shelter (`provisionShelter`, created through the
 *     system-management UI) — never on SH001–SH004;
 *   - campaigns and queue slots are set up through the back-office screens
 *     (`createCampaignViaUi`, `addSlotViaUi`); admin APIs (`couchReq`) only read state
 *     back for assertions and tear down;
 *   - everything it creates is recorded in a per-run `RunLedger` the moment it exists,
 *     and `teardownRun` removes exactly those ids (never search results);
 *   - the last test of each spec calls `expectRunGone` (zero-leak).
 * Bookings go through the BFF's reCAPTCHA gate, so each spec turns it off for its run with
 * `suspendRecaptcha` (README §known issues: a fake token does not pass Enterprise).
 *
 * Residue the test side cannot remove: the Mongo donation buffer / `public_donations`
 * rows of the bookings (and the closed `public_shelters` row, which the worker's retention
 * job drops within minutes). The donor path is the only API that can release them, so
 * `teardownRun` cancels every booking that is still open first — quota and queue places go
 * back — and the rest ages out with the buffer's TTL.
 */

export const RUN_ID = Date.now().toString(36) + Math.random().toString(36).substring(2, 6);

export type PublicNeed = {
	item_id: string;
	name: string;
	status: string;
	qty_needed: string | number;
	urgency?: string;
	on_hand?: string | number;
	reserved?: string | number;
};
export type PublicShelter = { code: string; name: string; needs: PublicNeed[] };

export type Staff = TestUser & { session: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Per-run ledger ────────────────────────────────────────────────────────────

const LEDGER_PATH = 'node_modules/.cache/donation-e2e-created.json';

export type LedgerBooking = { token: string; ref: string; shelter: string };
type LedgerData = { shelters: string[]; staff: string[]; bookings: LedgerBooking[] };

/**
 * Everything one spec creates, written the moment it exists. Playwright restarts the
 * worker after a failed serial test, which wipes module state — a file survives that (and
 * a crashed run), so the next teardown removes exactly the ids this spec recorded, never
 * anything found by searching. One entry per spec, so specs never touch each other's ids.
 */
export class RunLedger {
	constructor(private readonly suite: string) {}

	private readAll(): Record<string, LedgerData> {
		try {
			return JSON.parse(readFileSync(LEDGER_PATH, 'utf8')) as Record<string, LedgerData>;
		} catch {
			return {};
		}
	}

	read(): LedgerData {
		const mine = this.readAll()[this.suite];
		return {
			shelters: mine?.shelters ?? [],
			staff: mine?.staff ?? [],
			bookings: mine?.bookings ?? []
		};
	}

	private write(data: LedgerData) {
		mkdirSync(dirname(LEDGER_PATH), { recursive: true });
		writeFileSync(LEDGER_PATH, JSON.stringify({ ...this.readAll(), [this.suite]: data }));
	}

	add(kind: 'shelters' | 'staff', value: string): void;
	add(kind: 'bookings', value: LedgerBooking): void;
	add(kind: keyof LedgerData, value: string | LedgerBooking): void {
		const data = this.read();
		(data[kind] as (string | LedgerBooking)[]).push(value);
		this.write(data);
	}

	clear(): void {
		this.write({ shelters: [], staff: [], bookings: [] });
	}
}

// ─── reCAPTCHA ─────────────────────────────────────────────────────────────────

/**
 * Turn `config:app.recaptcha_enabled` off as the CouchDB admin, the same switch
 * pre-register flips (`setRecaptcha`). It is global, so call this only once the spec
 * knows it will run, and always await the returned restore in `afterAll` — it puts
 * back whatever state the switch had before.
 */
export async function suspendRecaptcha(browser: Browser): Promise<() => Promise<void>> {
	const admin = await bootstrapAdminSession();
	const context = await browser.newContext();
	const page = await context.newPage();
	await routeBrowserCouchThroughApp(page);
	await injectSession(page, admin.user, admin.cookie);
	const wasEnabled = await setRecaptcha(page, false);
	return async () => {
		try {
			await setRecaptcha(page, wasEnabled);
		} finally {
			// Drop the routes first so an in-flight `_changes` long-poll cannot reject close().
			await Promise.all(context.pages().map((p) => p.unrouteAll({ behavior: 'ignoreErrors' })));
			await context.close();
		}
	};
}

/**
 * Type a far-future expiry into a `DatePicker` (DD/MM/YYYY) and leave the field, which
 * also closes the calendar the click opened.
 */
export async function fillExpiry(field: Locator, ddmmyyyy = '31/12/2030') {
	await field.fill(ddmmyyyy);
	await field.press('Tab');
	await expect(field).toHaveValue(ddmmyyyy);
}

export async function publicNeedsBoard(request: APIRequestContext): Promise<PublicShelter[]> {
	const res = await request.get('/api/public/v1/needs');
	expect(res.ok(), `needs board unavailable (HTTP ${res.status()}) — is FastAPI up?`).toBe(true);
	return (await res.json()) as PublicShelter[];
}

// ─── Own E2E shelter + staff ───────────────────────────────────────────────────

/**
 * Create this run's own `E2E …` shelter through the system-management UI (CouchDB admin
 * session, the only identity allowed to provision shelters), record it in `ledger`, and
 * wait until the public plane serves it as `open` — FastAPI refuses bookings for a shelter
 * it has not projected yet (SHELTER_NOT_FOUND).
 */
export async function provisionShelter(
	browser: Browser,
	ledger: RunLedger,
	tag: string
): Promise<{ code: string; name: string }> {
	const name = `E2E Donation ${tag} ${RUN_ID}`;
	const admin = await bootstrapAdminSession();
	const context = await browser.newContext();
	try {
		const page = await context.newPage();
		await routeBrowserCouchThroughApp(page);
		await injectSession(page, admin.user, admin.cookie);
		const code = await createShelterViaUi(page, {
			name,
			siteKind: 'evacuation_center',
			lat: 7.006,
			lng: 100.498,
			subdistrict: 'คอหงส์',
			capacity: 40
		});
		ledger.add('shelters', code);
		await waitForProjection(
			`${code} open on the public plane`,
			async () => (await publicShelter(code))?.status === 'open',
			{ timeoutMs: 60_000, intervalMs: 2_000 }
		);
		return { code, name };
	} finally {
		// Drop the routes first so an in-flight `_changes` long-poll cannot reject close().
		await Promise.all(context.pages().map((p) => p.unrouteAll({ behavior: 'ignoreErrors' })));
		await context.close();
	}
}

/**
 * Flat roles, like `pnpm seed` — the compound form gets past the route guard but not
 * past `catalog._security` (see stock-donations.test.ts). Recorded in `ledger` before
 * the user exists, so a crash in between still deletes it.
 */
export async function createWarehouseStaff(
	ledger: RunLedger,
	shelterCode: string,
	tag: string
): Promise<Staff> {
	const user: TestUser = {
		name: `dn_${tag}_${RUN_ID}`,
		password: 'Password1!',
		roles: [`shelter:${shelterCode}`, 'warehouse_staff'],
		display_name: `Donation E2E ${tag}`
	};
	ledger.add('staff', user.name);
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return { ...user, session: await couchLogin(user.name, user.password) };
}

/** A system admin — no shelter of their own, so `openBackOffice` needs `workingShelter`. */
export async function createSystemAdmin(ledger: RunLedger, tag: string): Promise<Staff> {
	const user: TestUser = {
		name: `dn_${tag}_${RUN_ID}`,
		password: 'Password1!',
		roles: SA_ROLES,
		display_name: `Donation E2E ${tag}`
	};
	ledger.add('staff', user.name);
	await createCouchUser(user);
	await seedSecurityQuestion(user.name);
	return { ...user, session: await couchLogin(user.name, user.password) };
}

export type DeliveryMode =
	| { kind: 'self'; slot?: RegExp }
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

/** Public needs board → `shelter`'s card, opened. */
export async function openShelter(page: Page, shelter: Pick<PublicShelter, 'name'>) {
	await page.goto('/donations');
	await expect(
		page.getByRole('heading', { name: /ของที่ศูนย์พักพิง\s*ต้องการตอนนี้/ })
	).toBeVisible();
	// The board lists only the first few shelters (most urgent first) and other suites' E2E
	// shelters run alongside this one — filter by name so the card is never behind "show more".
	const search = page.getByRole('textbox', { name: 'ค้นหาศูนย์พักพิงหรือสิ่งของ' });
	await search.fill(shelter.name);
	await search.blur(); // closes the suggestion dropdown that would sit over the cards
	await cardWith(page, shelter.name, 'ดูรายละเอียดและบริจาค').click();
}

/** Public needs board → `shelter`'s card → the line for `itemName` (as the board prints it). */
export async function openNeed(page: Page, shelter: Pick<PublicShelter, 'name'>, itemName: string) {
	await openShelter(page, shelter);
	await cardWith(page, itemName, 'บริจาครายการนี้').click();
}

/** An item the donor types in themselves ("บริจาคสิ่งของอื่นๆ") instead of picking a need card. */
export type UnsolicitedItem = { itemName: string; unitLabel: string };

export type BookingOptions = {
	shelter: Pick<PublicShelter, 'code' | 'name'>;
	/** The need card to book against — or `unsolicited` to type the item in yourself. */
	need?: Pick<PublicNeed, 'name'>;
	unsolicited?: UnsolicitedItem;
	donorName: string;
	phone: string;
	mode?: DeliveryMode;
	/** How many units to declare — 1 unless a test needs more. */
	qty?: number;
	/** Image files to attach on the typed-in form (CR-175 donor photos) — `unsolicited` only. */
	photos?: string[];
	/** Every accepted booking is recorded here for `teardownRun`. */
	ledger: RunLedger;
};

export type BookingResponse = Partial<Booking> & {
	success: boolean;
	error?: string | { code: string; message: string };
};

/**
 * Walk the public wizard up to — not past — "ยืนยันการจองคิวบริจาค" (qty 1 unless `opts.qty`).
 * Returns `submit`, which presses it and hands back the BFF's answer unasserted, so
 * two donors can be brought to the button first and made to press it together.
 */
export async function fillBooking(
	page: Page,
	opts: BookingOptions
): Promise<{ submit: () => Promise<BookingResponse> }> {
	const { shelter, need, unsolicited, donorName, phone } = opts;
	const mode = opts.mode ?? { kind: 'self' };

	if (unsolicited) {
		await openShelter(page, shelter);
		await page.getByRole('button', { name: 'บริจาคสิ่งของอื่นๆ' }).click();
	} else {
		if (!need) throw new Error('fillBooking needs either `need` or `unsolicited`');
		await openNeed(page, shelter, need.name);
	}

	// Step 2 — donor + item. A need card brings its own name/unit; a typed item does not.
	await expect(page.getByRole('heading', { name: 'ส่วนที่ 1: ข้อมูลผู้บริจาค' })).toBeVisible();
	await page.locator('#donor-name').fill(donorName);
	await page.locator('#donor-phone').fill(phone);
	if (unsolicited) {
		await page.getByRole('textbox', { name: 'ประเภทสิ่งของ' }).fill(unsolicited.itemName);
		await page.getByRole('button', { name: /^หน่วย/ }).click();
		await page.getByRole('option', { name: unsolicited.unitLabel, exact: true }).click();
	} else {
		await expect(page.getByRole('textbox', { name: 'ประเภทสิ่งของ' })).toHaveValue(need!.name);
	}
	await page.getByRole('spinbutton', { name: 'ปริมาณ' }).fill(String(opts.qty ?? 1));
	if (opts.photos?.length) await attachDonorPhotos(page, opts.photos);
	await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();

	// Step 3 — logistics. The destination is locked to the card's shelter.
	await expect(
		page.getByRole('heading', { name: 'ส่วนที่ 3: ข้อมูลการจัดส่ง โลจิสติกส์' })
	).toBeVisible();
	// #814: step 3 shows the locked shelter read-only (no dropdown, no "locked" badge).
	await expect(page.getByTestId('drop-off-shelter-name')).toHaveText(shelter.name);
	const button = page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' });

	if (mode.kind === 'self') {
		await page.getByRole('button', { name: 'นำมาส่งด้วยตนเอง' }).click();
		await page.getByRole('button', { name: 'รถยนต์' }).click();
		// A named window when the test sets one up, else the first free standard window.
		const freeSlot = page
			.getByRole('button', { name: mode.slot ?? /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ })
			.first();
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
			const body = (await (await posted).json()) as BookingResponse;
			if (body.success && body.bookingRef && body.trackingToken) {
				opts.ledger.add('bookings', {
					token: body.trackingToken,
					ref: body.bookingRef,
					shelter: shelter.code
				});
			}
			return body;
		}
	};
}

/**
 * Pick `files` in the typed-in form's photo section and wait until every one is stored
 * (one `POST /api/public/v1/donations/photos` each) and none is still uploading.
 */
export async function attachDonorPhotos(page: Page, files: string[]) {
	const picker = page.getByTestId('donor-photo-picker');
	await expect(picker.getByRole('heading', { name: /รูปของที่จะบริจาค/ })).toBeVisible();
	let stored = 0;
	const onResponse = (r: { url(): string; status(): number }) => {
		if (r.url().endsWith('/api/public/v1/donations/photos') && r.status() === 201) stored++;
	};
	page.on('response', onResponse);
	try {
		await page.getByTestId('donor-photo-input').setInputFiles(files);
		await expect.poll(() => stored, { timeout: 30_000 }).toBe(files.length);
		await expect(picker.getByRole('status')).toHaveCount(0);
		await expect(picker.getByText(`${files.length} / 30 รูป`)).toBeVisible();
	} finally {
		page.off('response', onResponse);
	}
}

/**
 * A booking of two lines — the campaign `need` and one typed-in line — posted to the BFF
 * the way the wizard does. The wizard books one line at a time, and per-line review
 * (CR-174) and per-line refusal at the counter (CR-172) need two. Parcel, so no slot.
 */
export async function bookMixedViaApi(
	request: APIRequestContext,
	opts: {
		shelter: Pick<PublicShelter, 'code'>;
		need: Pick<PublicNeed, 'item_id' | 'name'>;
		needUnit: string;
		typedItem: string;
		donorName: string;
		phone: string;
		ledger: RunLedger;
	}
): Promise<Booking> {
	const res = await request.post('/api/public/v1/donations', {
		data: {
			shelter_code: opts.shelter.code,
			donor: { name: opts.donorName, phone: opts.phone },
			items: [
				{ item_id: opts.need.item_id, free_text: opts.need.name, qty: 1, unit: opts.needUnit },
				{ free_text: opts.typedItem, category: 'other', qty: 2, unit: 'piece', condition: 'new' }
			],
			logistics: { delivery_method: 'parcel' }
		}
	});
	const body = (await res.json()) as BookingResponse;
	expect(body.success, `mixed booking POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;
	opts.ledger.add('bookings', {
		token: trackingToken,
		ref: bookingRef,
		shelter: opts.shelter.code
	});
	return { bookingRef, trackingToken };
}

/** Walk the public wizard for `need` at `shelter` (qty 1 unless `opts.qty`); asserts the ticket. */
export async function bookAsDonor(page: Page, opts: BookingOptions): Promise<Booking> {
	const { submit } = await fillBooking(page, opts);
	const body = await submit();
	// Under `vite preview` (not dev) with no reCAPTCHA keys the BFF fails closed with
	// SERVER_MISCONFIGURED — run against `pnpm dev` locally (PLAYWRIGHT_TEST_BASE_URL=
	// http://localhost:5173). RATE_LIMITED is nginx's per-IP limit on the donation routes: wait
	// a minute between back-to-back runs.
	expect(body.success, `booking POST failed: ${JSON.stringify(body)}`).toBe(true);
	const { bookingRef, trackingToken } = body as Booking;

	// Step 4 — CR-174: a booking of campaign lines is approved at once and its ticket
	// carries the QR (AC-1); a typed-in line waits for staff review.
	if (opts.unsolicited) {
		await expect(
			page.getByRole('heading', { name: 'ส่งรายการรอเจ้าหน้าที่ตรวจสอบ' })
		).toBeVisible();
	} else {
		await expect(page.getByRole('heading', { name: 'สำเร็จ! ตั๋วบริจาคของคุณ' })).toBeVisible();
		await expect(page.getByTestId('ticket-qr')).toBeVisible();
	}
	await expect(page.getByText(bookingRef).first()).toBeVisible();
	return { bookingRef, trackingToken };
}

const routedPages = new WeakSet<Page>();

/**
 * Open stock-donations as `staff`.
 *
 * The active shelter is pinned in localStorage first: the back-office layout re-mounts its
 * children (`{#key shelterStore.selectedShelterCode}`) when the selection flips from
 * `undefined` to a code after the shelter list loads. Unpinned, that remount lands after the
 * tab is visible and resets the sub-tab / detaches forms the test is already filling in.
 */
export async function openBackOffice(page: Page, staff: Staff, workingShelter?: string) {
	if (!routedPages.has(page)) {
		routedPages.add(page);
		await routeBrowserCouchThroughApp(page);
	}
	await injectSession(page, staff, staff.session);
	const shelterCode =
		workingShelter ?? staff.roles.find((r) => r.startsWith('shelter:'))?.slice('shelter:'.length);
	if (shelterCode) await pinActiveShelter(page, shelterCode);
	await page.goto('/back-office/stock-donations');
	await expect(page.getByRole('tab', { name: /รายการของบริจาค/ })).toBeVisible({ timeout: 15_000 });
}

/**
 * The booking reaches CouchDB through the sync worker, so it can trail the ticket by a
 * few seconds. The queue loads once at mount — reload until the row is there.
 */
export async function openPendingRow(page: Page, bookingRef: string) {
	const row = page.getByRole('row').filter({ hasText: bookingRef });
	await expect(async () => {
		await page.reload();
		await page.getByRole('tab', { name: /รายการของบริจาค/ }).click();
		await page.getByRole('button', { name: /^รอประเมิน/ }).click();
		await expect(row).toBeVisible({ timeout: 3_000 });
	}).toPass({ timeout: 30_000 });
	await row.getByRole('button', { name: 'จัดการ' }).click();
	await expect(page.getByRole('heading', { name: new RegExp(`^${bookingRef} - `) })).toBeVisible();
}

/**
 * Accept every line waiting for review (CR-174 — one decision per pending line) and wait
 * for CouchDB to flip to `verifying`. Only a booking with a typed-in line is in the queue.
 */
export async function approvePending(page: Page, shelterCode: string, bookingRef: string) {
	await openPendingRow(page, bookingRef);
	await page.getByRole('textbox', { name: /Internal Review Memo/ }).fill(`e2e ${RUN_ID}`);
	// Anchored — "ไม่รับรายการนี้" contains the same words, and each half carries a hint.
	const keep = page.getByRole('button', { name: /^รับรายการนี้/ });
	for (const button of await keep.all()) await button.click();
	await page.getByRole('button', { name: 'บันทึกผลการประเมิน' }).click();
	await expect(page.getByText(`บันทึกผลการประเมิน ${bookingRef} แล้ว`)).toBeVisible();
	await expectReadyForDropoff(shelterCode, bookingRef);
}

/**
 * A booking of campaign lines skips the review queue (CR-174 AC-1): it reaches CouchDB
 * already `verifying`, its lines approved by the campaign rule.
 */
export async function expectReadyForDropoff(shelterCode: string, bookingRef: string) {
	await expect
		.poll(async () => (await findDonation(shelterCode, bookingRef))?.status, { timeout: 30_000 })
		.toBe('verifying');
}

/**
 * Reject the open booking through the reject dialog (CR-172): pick the preset whose
 * label matches `reason`, add `note`, confirm. The confirm stays disabled until the
 * reason is complete, which every caller relies on. `noteRequired` ("อื่นๆ") also checks
 * that the preset alone is not enough (AC-4) and the note is marked required.
 */
export async function rejectInDialog(
	page: Page,
	reason: RegExp,
	note?: string,
	{ noteRequired = false }: { noteRequired?: boolean } = {}
) {
	await page.getByRole('button', { name: 'ปฏิเสธคำขอ' }).click();
	const dialog = page.getByRole('dialog', { name: 'ปฏิเสธใบบริจาค' });
	const confirm = dialog.getByRole('button', { name: 'ยืนยันปฏิเสธ' });
	await expect(confirm).toBeDisabled();
	await dialog.getByRole('radio', { name: reason }).click();
	const noteBox = dialog.getByRole('textbox', { name: /รายละเอียดเพิ่มเติม/ });
	if (noteRequired) {
		await expect(noteBox).toHaveAttribute('aria-required', 'true');
		await expect(confirm).toBeDisabled();
	}
	if (note) await noteBox.fill(note);
	await confirm.click();
	await expect(dialog).toBeHidden();
}

/** Open a booking in the scan station by typing its ref. */
export async function openInScanStation(page: Page, bookingRef: string) {
	await page.reload();
	// The active tab is kept in `?tab=` and survives the reload, so the list is picked
	// explicitly; the scanner sits at its top right (#617).
	await page.getByRole('tab', { name: /รายการของบริจาค/ }).click();
	await page.getByRole('button', { name: 'สแกนรับเข้าคลัง' }).click();
	await page.getByRole('textbox', { name: 'รหัสการจอง' }).fill(bookingRef);
	await page.getByRole('button', { name: 'ค้นหา' }).click();
	await expect(
		page.getByRole('heading', { name: `${bookingRef} - ตรวจรับพัสดุบริจาค` })
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

/** A photo doc as CouchDB holds it — `null` once it is gone. */
export async function findImage(shelterCode: string, imageId: string) {
	const res = await couchReq('GET', `/${shelterDb(shelterCode)}/${encodeURIComponent(imageId)}`);
	return res.status === 200 ? (res.data as Record<string, unknown>) : null;
}

export async function ledgerRowsFor(shelterCode: string, donationId: string) {
	const res = await couchReq('POST', `/${shelterDb(shelterCode)}/_find`, {
		selector: { type: 'stock_ledger', reason: 'donation', ref_id: donationId },
		limit: 10
	});
	return (res.data as { docs: { item_id: string; qty: string }[] }).docs;
}

export type SlotWindow = { from: string; to: string };

/** Asia/Bangkok YYYY-MM-DD — the wizard and the slot screen both default to it. */
export function todayYmd() {
	return bangkokToday();
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
 * The public track page reads the Mongo projection, which trails CouchDB by the sync
 * worker, and does not refetch on its own. After a write, reload until `target` shows.
 */
export async function reloadUntilVisible(page: Page, target: Locator, timeout = 20_000) {
	await expect(async () => {
		if (!(await target.isVisible())) await page.reload();
		await expect(target).toBeVisible({ timeout: 2_000 });
	}).toPass({ timeout });
}

// ─── Setup through the back-office UI ──────────────────────────────────────────

/**
 * Back office → จัดการความต้องการ → สร้างประกาศ…: open a campaign for the catalog item
 * `item` with `target` units (the unit is the catalog's `base_unit`, not typed), then wait
 * for its line on the public board. The campaign binds to a real `item_master` id, so
 * donations to it can be received into stock.
 */
export async function createCampaignViaUi(
	page: Page,
	request: APIRequestContext,
	staff: Staff,
	shelterCode: string,
	opts: { item: string; target: number; notes: string }
): Promise<PublicNeed> {
	await openBackOffice(page, staff);
	await page.getByRole('tab', { name: 'จัดการความต้องการ' }).click();
	await page.getByRole('button', { name: /สร้างประกาศแบบกำหนดเอง/ }).click();
	await expect(page.getByRole('heading', { name: 'สร้างประกาศขอรับบริจาค' })).toBeVisible();
	const picker = page.locator('#campaign-item-title');
	await picker.fill(opts.item);
	await picker.press('Enter');
	await expect(page.getByText('เลือกรายการพัสดุก่อน')).toHaveCount(0);
	await page.getByRole('textbox', { name: /จำนวนเป้าหมาย/ }).fill(String(opts.target));
	await page.getByRole('textbox', { name: /เหตุผลหรือรายละเอียดเพิ่มเติม/ }).fill(opts.notes);
	await page.getByRole('button', { name: 'ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ' }).click();
	await expect(page.getByText(`เพิ่มประกาศความต้องการ "${opts.item}" สำเร็จ`)).toBeVisible();
	await expect
		.poll(async () => (await boardLineFor(request, shelterCode, opts.item))?.status, BOARD_SYNC)
		.toBe('open');
	return (await boardLineFor(request, shelterCode, opts.item))!;
}

export type SlotMode = 'ผู้บริจาคมาส่งเอง' | 'รถศูนย์ไปรับ';

/** Back office → ช่วงเวลารับของ, on the queue for `mode`. */
export async function openSlots(page: Page, staff: Staff, mode: SlotMode) {
	await openBackOffice(page, staff);
	await page.getByRole('tab', { name: 'ช่วงเวลารับของ' }).click();
	await expect(page.getByRole('heading', { name: 'ช่วงเวลารับของบริจาค' })).toBeVisible();
	await page.getByRole('button', { name: mode, exact: true }).click();
	// Under load the schedule and booking reads can trail past the 5 s default. Settle both
	// first: the "คิวเต็ม" badge and the "จองแล้ว N / M" count only render once bookings load
	// (until then each row shows "–" and the "รอข้อมูลการจองก่อน…" hint).
	await expect(page.getByText('กำลังโหลดช่วงเวลา...')).toHaveCount(0, BOARD_SYNC);
	await expect(page.getByText('รอข้อมูลการจองก่อน จึงจะลบได้')).toHaveCount(0, BOARD_SYNC);
}

/** Filtered on "จองแล้ว" too: the success toast is also an <li> carrying the window. */
export function slotRow(page: Page, w: SlotWindow) {
	return page
		.getByRole('listitem')
		.filter({ hasText: `${w.from} - ${w.to}` })
		.filter({ hasText: 'จองแล้ว' });
}

/** Add `w` today on the slot screen already open (`openSlots`); returns its list row. */
export async function addSlotViaUi(page: Page, w: SlotWindow, capacity?: number, note = '') {
	await page.locator('#slot-from').fill(w.from);
	await page.locator('#slot-to').fill(w.to);
	if (capacity !== undefined) await page.locator('#slot-capacity').fill(String(capacity));
	await page.locator('#slot-note').fill(note || `e2e ${RUN_ID}`);
	await page.getByRole('button', { name: 'เพิ่มช่วงเวลา' }).click();
	const row = slotRow(page, w);
	await expect(row).toBeVisible();
	return row;
}

// ─── Teardown + zero-leak ──────────────────────────────────────────────────────

/** What `teardownRun` removed — the input of `expectRunGone`. */
export type TornDown = ReturnType<RunLedger['read']>;

/**
 * Cancel the bookings of this run that are still open, as their donor would (DELETE
 * through the BFF). That hands the need's reserved quantity and the queue place back —
 * Mongo counters that no shelter delete would ever release. Terminal bookings (received,
 * rejected, already cancelled) answer 400 and are left as they are.
 *
 * A booking is only done once its DELETE answers 400: a 200 is asked again in the next
 * round, because the sync worker can write its stale Mongo status back over a fresh
 * cancel (the booking then reads `verifying` again). 409 means inbound has the row but
 * CouchDB does not show it yet, or a concurrent write won. Anything else, or a booking
 * still open after the last round, throws with the last status and body.
 */
async function cancelOpenBookings(request: APIRequestContext, bookings: LedgerBooking[]) {
	let open = bookings.map((b) => ({ b, last: 'not asked' }));
	for (let round = 0; round < 6 && open.length > 0; round++) {
		if (round > 0) await sleep(3_000);
		const next: typeof open = [];
		for (const { b } of open) {
			const res = await request.delete(`/api/public/v1/donations/${b.token}`);
			const last = `${res.status()} ${await res.text()}`;
			if (res.status() === 400) continue;
			if (res.status() !== 200 && res.status() !== 409) {
				throw new Error(`cancel of ${b.ref} failed: ${last}`);
			}
			next.push({ b, last });
		}
		open = next;
	}
	if (open.length > 0) {
		const left = open.map(({ b, last }) => `${b.ref} (${last})`).join('; ');
		throw new Error(`still open after 6 cancel rounds: ${left}`);
	}
}

/**
 * After cancelling, the sync worker re-projects the shelter's needs and settles the
 * intake buffer in the same pass: once no line of the shelter reserves anything any more,
 * the counters are back. Best effort — a slow worker must not stop the teardown.
 */
async function waitForReservationsReleased(request: APIRequestContext, shelterCode: string) {
	try {
		await expect
			.poll(
				async () =>
					(await publicNeedsBoard(request))
						.find((s) => s.code === shelterCode)
						?.needs.every((n) => Number(n.reserved ?? 0) === 0) ?? true,
				BOARD_SYNC
			)
			.toBe(true);
	} catch {
		console.warn(`reservations of ${shelterCode} not released within ${BOARD_SYNC.timeout} ms`);
	}
}

/**
 * Remove exactly what `ledger` lists: cancel open bookings, wait for the quota to come
 * back, tear the E2E shelters down (`teardownShelter` refuses anything not named `E2E …`),
 * delete the staff users, then empty the ledger. Idempotent — safe to call from both the
 * Z test and afterAll.
 */
export async function teardownRun(
	request: APIRequestContext,
	ledger: RunLedger
): Promise<TornDown> {
	const run = ledger.read();
	// Releasing counters is best effort: whatever happens there, the shelter and the staff
	// users are still removed (and the ledger only cleared once they are).
	try {
		await cancelOpenBookings(request, run.bookings);
		for (const code of new Set(run.bookings.map((b) => b.shelter))) {
			await waitForReservationsReleased(request, code);
		}
	} finally {
		for (const code of run.shelters) await teardownShelter(code);
		for (const name of run.staff) await deleteCouchUser(name);
		ledger.clear();
	}
	return run;
}

/** Statuses after which a booking no longer holds quota or a queue place. */
const RELEASED_STATUSES = ['cancelled', 'rejected', 'received', 'expired', 'redirected'];

/**
 * Zero-leak: nothing of `run` is left where the test side can see it — no shelter
 * database or registry row, nothing on the public needs board, no staff user, and no
 * booking still holding quota. The closed `public_shelters` row lingers until the worker's
 * retention job drops it; it only has to be unbookable.
 */
export async function expectRunGone(request: APIRequestContext, run: TornDown) {
	for (const code of run.shelters) {
		expect((await couchReq('GET', `/${shelterDb(code)}`)).status).toBe(404);
		const byCode = await couchReq(
			'GET',
			`/registry/_design/app/_view/by_code?key=${encodeURIComponent(JSON.stringify(code))}`
		);
		expect((byCode.data as { rows: unknown[] }).rows).toEqual([]);
		await expect
			.poll(async () => (await publicNeedsBoard(request)).some((s) => s.code === code), BOARD_SYNC)
			.toBe(false);
		const row = await publicShelter(code);
		expect(row === undefined || row.status === 'closed', `${code} left as ${row?.status}`).toBe(
			true
		);
	}
	for (const name of run.staff) {
		expect(
			(await couchReq('GET', `/_users/org.couchdb.user:${encodeURIComponent(name)}`)).status
		).toBe(404);
	}
	// FastAPI caps donation routes at 30/min per IP and the BFF does not forward the caller's
	// IP yet (#458), so a busy run can see 429 here. Poll past one full 60 s window.
	for (const b of run.bookings) {
		await expect
			.poll(
				async () => {
					const res = await request.get(`/api/public/v1/donations/${b.token}`);
					return ((await res.json()) as { donation?: { status?: string } }).donation?.status;
				},
				{ timeout: 75_000, intervals: [2_000, 3_000, 5_000] }
			)
			.toEqual(expect.stringMatching(new RegExp(`^(${RELEASED_STATUSES.join('|')})$`)));
	}
}
