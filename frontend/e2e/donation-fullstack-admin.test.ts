import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { couchReq } from './helpers/couch';
import { clearSession } from './helpers/login';
import {
	RUN_ID,
	bookAsDonor,
	createWarehouseStaff,
	deleteDoc,
	deleteStaff,
	findDonation,
	freeEveningWindows,
	ledgerRowsFor,
	openBackOffice,
	needLabel,
	openNeed,
	catalogItem,
	pickOpenNeed,
	publicNeedsBoard,
	runDocs,
	shelterDb,
	skipUnlessFullStack,
	todayYmd,
	type PublicNeed,
	type PublicShelter,
	type SlotWindow,
	type Staff
} from './helpers/donation-fullstack';

/**
 * Back-office setup that the donor side depends on, against the REAL stack:
 * campaigns on the public needs board, queue slots, and counter walk-ins.
 *   PW_BASE_URL=http://localhost:5173 pnpm test:e2e e2e/donation-fullstack-admin.test.ts
 *
 * Unlike the donor spec this one cleans up after itself: the campaign and slot docs it
 * writes are deleted in afterAll (matched on RUN_ID). Bookings and the walk-in's ledger
 * row stay — the ledger is append-only.
 */

// Exists only as `item_master:canned-fish`, and no seeded campaign asks for it, so the
// board line this spec creates is the only one for that item.
const CAMPAIGN_ITEM = 'ปลากระป๋อง';

let board: PublicShelter[];
let campaignShelter: PublicShelter;
let slotShelter: PublicShelter;
let slotNeed: PublicNeed;
let campaignStaff: Staff;
let slotStaff: Staff;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ request }) => {
	skipUnlessFullStack(test.skip);
	board = await publicNeedsBoard(request);
	const pick = pickOpenNeed(board);
	test.skip(!pick, 'no open need on the public board — run `pnpm seed` first');
	({ shelter: slotShelter, need: slotNeed } = pick!);
	const other = board.find((s) => !s.needs.some((n) => n.name === CAMPAIGN_ITEM));
	test.skip(!other, `every shelter already asks for ${CAMPAIGN_ITEM}`);
	campaignShelter = other!;

	campaignStaff = await createWarehouseStaff(campaignShelter.code, 'camp');
	slotStaff =
		slotShelter.code === campaignShelter.code
			? campaignStaff
			: await createWarehouseStaff(slotShelter.code, 'slot');
});

test.afterAll(async ({ request }) => {
	if (campaignShelter) {
		// Close before deleting: the worker does not re-project needs on a campaign
		// DELETE, so a straight delete leaves the line on the public board for good.
		// A closed campaign is retracted; once it is off the board the doc can go.
		const db = shelterDb(campaignShelter.code);
		const camps = await runDocs(db, 'donation_campaign', 'notes');
		for (const c of camps) {
			await couchReq('PUT', `/${db}/${encodeURIComponent(c._id)}`, {
				...c,
				status: 'closed',
				visible_on_home: false
			});
		}
		if (camps.length) {
			await expect.poll(async () => await boardLine(request), SYNC).toBeUndefined();
		}
		for (const c of await runDocs(db, 'donation_campaign', 'notes')) await deleteDoc(db, c);
	}
	if (slotShelter) {
		const db = shelterDb(slotShelter.code);
		// `note` for the windows added by hand, `created_by` (the run's staff user) for
		// the standard windows, which carry no note.
		const slots = [
			...(await runDocs(db, 'donation_slot', 'note')),
			...(await runDocs(db, 'donation_slot', 'created_by'))
		];
		const seen = new Set<string>();
		for (const d of slots) {
			if (seen.has(d._id)) continue;
			seen.add(d._id);
			await deleteDoc(db, d);
		}
	}
	await deleteStaff(campaignStaff);
	if (slotStaff !== campaignStaff) await deleteStaff(slotStaff);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
});

/** The public board's line for CAMPAIGN_ITEM at the campaign shelter, if any. */
async function boardLine(request: APIRequestContext) {
	const res = await request.get('/api/public/v1/needs');
	const shelters = (await res.json()) as PublicShelter[];
	return shelters
		.find((s) => s.code === campaignShelter.code)
		?.needs.find((n) => n.name === CAMPAIGN_ITEM);
}

// Campaigns reach the public board through the worker's Mongo projection.
const SYNC = { timeout: 30_000 };

test.describe('needs board (campaigns)', () => {
	test('create → public board → edit → hide → force cut-off → reopen', async ({
		page,
		request
	}) => {
		test.setTimeout(180_000);
		await openBackOffice(page, campaignStaff);
		await page.getByRole('tab', { name: 'จัดการความต้องการ' }).click();

		// ── Create ──────────────────────────────────────────────────────────────
		await page.getByRole('button', { name: /สร้างประกาศแบบกำหนดเอง/ }).click();
		await expect(page.getByRole('heading', { name: 'สร้างประกาศขอรับบริจาค' })).toBeVisible();
		const picker = page.locator('#campaign-item-title');
		await picker.fill(CAMPAIGN_ITEM);
		await picker.press('Enter');
		await expect(page.getByText('กระป๋อง', { exact: true }).first()).toBeVisible();
		await page.getByRole('textbox', { name: /จำนวนเป้าหมาย/ }).fill('40');
		await page
			.getByRole('textbox', { name: /เหตุผลหรือรายละเอียดเพิ่มเติม/ })
			.fill(`e2e ${RUN_ID}`);
		await page.getByRole('button', { name: 'ประกาศขอรับบริจาคผ่านหน้าเว็บสาธารณะ' }).click();
		await expect(page.getByText(`เพิ่มประกาศความต้องการ "${CAMPAIGN_ITEM}" สำเร็จ`)).toBeVisible();

		const row = page.getByRole('row').filter({ hasText: CAMPAIGN_ITEM });
		await expect(row).toBeVisible();
		await expect(row).toContainText('40 กระป๋อง');

		// The default level on the form is critical; the board reads the stored level.
		await expect.poll(async () => (await boardLine(request))?.urgency, SYNC).toBe('critical');
		expect(Number((await boardLine(request))!.qty_needed)).toBe(40);

		// ── The donor sees it ───────────────────────────────────────────────────
		await clearSession(page);
		// Opening the line proves it is bookable at THIS shelter, not just listed somewhere.
		await openNeed(page, campaignShelter, CAMPAIGN_ITEM);
		await expect(page.getByRole('textbox', { name: 'ประเภทสิ่งของ' })).toHaveValue(CAMPAIGN_ITEM);

		// ── Edit the target ─────────────────────────────────────────────────────
		await openBackOffice(page, campaignStaff);
		await page.getByRole('tab', { name: 'จัดการความต้องการ' }).click();
		await row.getByRole('button', { name: 'แก้ไข' }).click();
		await expect(page.getByRole('heading', { name: 'แก้ไขประกาศ (Edit Campaign)' })).toBeVisible();
		await page.getByRole('textbox', { name: /เป้าหมายที่ต้องการ/ }).fill('25');
		await page.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
		await expect(row).toContainText('25 กระป๋อง');
		await expect.poll(async () => Number((await boardLine(request))?.qty_needed), SYNC).toBe(25);

		// ── Hide from the public home ───────────────────────────────────────────
		await row.getByRole('button', { name: 'กำลังโชว์บนหน้าเว็บ' }).click();
		await expect(page.getByText(`ซ่อน "${CAMPAIGN_ITEM}" จากหน้าแรก`)).toBeVisible();
		await expect.poll(async () => await boardLine(request), SYNC).toBeUndefined();
		// …and back, so the cut-off below has a public line to close.
		await row.getByRole('button', { name: 'ซ่อนจากหน้าเว็บ' }).click();
		await expect.poll(async () => (await boardLine(request))?.status, SYNC).toBe('open');

		// ── Force cut-off needs a reason ────────────────────────────────────────
		await row.getByRole('button', { name: 'Force Cut-off' }).click();
		const dialog = page.getByRole('dialog', { name: 'ปิดรับบริจาคด่วน (Force Cut-off)' });
		const confirm = dialog.getByRole('button', { name: 'ยืนยันปิดรับ' });
		await expect(confirm).toBeDisabled();
		await dialog.getByRole('textbox', { name: 'เหตุผลการปิดรับ *' }).fill(`คลังเต็ม ${RUN_ID}`);
		await confirm.click();
		await expect(page.getByText(`ปิดรับบริจาคสำหรับ "${CAMPAIGN_ITEM}" แล้ว`)).toBeVisible();
		await expect
			.poll(async () => (await boardLine(request))?.status ?? 'gone', SYNC)
			.not.toBe('open');

		// ── Reopen: no reason asked ─────────────────────────────────────────────
		await row.getByRole('button', { name: 'เปิดรับบริจาค (Restore)' }).click();
		await expect(page.getByText(`เปิดรับบริจาคสำหรับ "${CAMPAIGN_ITEM}" อีกครั้ง`)).toBeVisible();
		await expect.poll(async () => (await boardLine(request))?.status, SYNC).toBe('open');
	});
});

test.describe('queue slots (DN-5)', () => {
	let PICKUP: SlotWindow;
	let DROPOFF: SlotWindow;
	let CAPPED: SlotWindow;

	test.beforeAll(async () => {
		const free = await freeEveningWindows(slotShelter.code, 3);
		test.skip(free.length < 3, 'no free evening window left today');
		[PICKUP, DROPOFF, CAPPED] = free;
	});

	async function openSlots(page: Page, mode: 'ผู้บริจาคมาส่งเอง' | 'รถศูนย์ไปรับ') {
		await openBackOffice(page, slotStaff);
		await page.getByRole('tab', { name: 'ช่วงเวลารับของ' }).click();
		await expect(page.getByRole('heading', { name: 'ช่วงเวลารับของบริจาค' })).toBeVisible();
		await page.getByRole('button', { name: mode, exact: true }).click();
	}

	/** Filtered on "จองแล้ว" too: the success toast is also an <li> carrying the window. */
	function slotRow(page: Page, w: SlotWindow) {
		return page
			.getByRole('listitem')
			.filter({ hasText: `${w.from} - ${w.to}` })
			.filter({ hasText: 'จองแล้ว' });
	}

	async function addSlot(page: Page, w: SlotWindow, capacity?: number) {
		await page.locator('#slot-from').fill(w.from);
		await page.locator('#slot-to').fill(w.to);
		if (capacity !== undefined) await page.locator('#slot-capacity').fill(String(capacity));
		await page.locator('#slot-note').fill(`e2e ${RUN_ID}`);
		await page.getByRole('button', { name: 'เพิ่มช่วงเวลา' }).click();
		return slotRow(page, w);
	}

	/** Anonymous donor up to the logistics step, with `mode` chosen. */
	async function donorAtLogistics(page: Page, mode: RegExp) {
		await clearSession(page);
		await openNeed(page, slotShelter, needLabel(slotNeed));
		await page.locator('#donor-name').fill(`E2E ดูคิว ${RUN_ID}`);
		await page.locator('#donor-phone').fill('0889012345');
		await page.getByRole('spinbutton', { name: 'ปริมาณ' }).fill('1');
		await page.getByRole('button', { name: 'ถัดไป: เลือกจุดส่งมอบ' }).click();
		await page.getByRole('button', { name: mode }).click();
	}

	const windowButton = (page: Page, w: SlotWindow) =>
		page.getByRole('button', { name: new RegExp(`^${w.from} - ${w.to}`) });

	/** Pick `ymd` in the wizard's calendar; its day buttons carry an English full date. */
	async function donorPicksDate(page: Page, ymd: string) {
		await page
			.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}$/ })
			.first()
			.click();
		const label = new Date(`${ymd}T00:00:00`).toLocaleDateString('en-US', {
			weekday: 'long',
			month: 'long',
			day: 'numeric',
			year: 'numeric'
		});
		const day = page.getByRole('button', { name: label, exact: true });
		if (!(await day.isVisible())) await page.getByRole('button', { name: 'Next' }).click();
		await day.click();
		// The popover stays open after a pick; left open, it eats the next click.
		await page.keyboard.press('Escape');
		await expect(page.getByRole('button', { name: ymd, exact: true }).first()).toBeVisible();
	}

	/** The slot screen's date box takes the Thai dd/mm/yyyy (Gregorian year). */
	async function staffPicksDate(page: Page, ymd: string) {
		const [y, m, d] = ymd.split('-');
		const box = page.getByRole('textbox', { name: 'วันที่ของช่วงเวลา' });
		await box.fill(`${d}/${m}/${y}`);
		await box.press('Enter');
		await expect(page.getByRole('heading', { name: `ช่วงเวลาวันที่ ${ymd}` })).toBeVisible();
	}

	test('pickup slot with 1 trip: booked → full for the next donor → freed by a cancel', async ({
		page
	}) => {
		await openSlots(page, 'รถศูนย์ไปรับ');
		const slot = await addSlot(page, PICKUP, 1);
		await expect(slot).toContainText('เปิดรับ');
		await expect(slot).toContainText('จองแล้ว 0 / 1 เที่ยว');

		await clearSession(page);
		const { bookingRef, trackingToken } = await bookAsDonor(page, {
			shelter: slotShelter,
			need: slotNeed,
			donorName: `E2E รถไปรับ ${RUN_ID}`,
			phone: '0878901234',
			mode: {
				kind: 'pickup',
				address: `99/1 ถ.ทดสอบ (e2e ${RUN_ID})`,
				slot: new RegExp(`^${PICKUP.from} - ${PICKUP.to} ว่าง`)
			}
		});
		await expect
			.poll(async () => {
				const d = await findDonation(slotShelter.code, bookingRef);
				return (d?.logistics as { pickup_address?: string } | undefined)?.pickup_address;
			})
			.toContain(RUN_ID);

		// Next donor: the one trip is taken.
		await donorAtLogistics(page, /ต้องการให้รถศูนย์ไปรับ/);
		await expect(windowButton(page, PICKUP)).toBeDisabled();
		await expect(windowButton(page, PICKUP)).not.toHaveAccessibleName(/ว่าง/);

		await openSlots(page, 'รถศูนย์ไปรับ');
		await expect(slot).toContainText('คิวเต็ม');
		await expect(slot).toContainText('จองแล้ว 1 / 1 เที่ยว');
		// Booked → it cannot be deleted, only closed.
		await expect(slot.getByRole('button', { name: 'ลบ' })).toBeDisabled();
		await expect(slot).toContainText('มีผู้จองแล้ว ลบไม่ได้');

		// The first donor cancels — the trip goes back on offer.
		await clearSession(page);
		await page.goto(`/donations/track/${trackingToken}`);
		await page.getByRole('button', { name: 'ยกเลิกการจองนี้' }).click();
		await page.getByRole('button', { name: 'ยืนยันยกเลิกการจอง' }).click();
		await expect
			.poll(async () => (await findDonation(slotShelter.code, bookingRef))?.status)
			.toBe('cancelled');
		await donorAtLogistics(page, /ต้องการให้รถศูนย์ไปรับ/);
		await expect(windowButton(page, PICKUP)).toBeEnabled();
		await expect(windowButton(page, PICKUP)).toHaveAccessibleName(/ว่าง/);
	});

	test('drop-off slot the staff close stays listed but cannot be picked, until reopened', async ({
		page
	}) => {
		await openSlots(page, 'ผู้บริจาคมาส่งเอง');
		const slot = await addSlot(page, DROPOFF);
		await expect(slot).toContainText('ไม่จำกัด');

		await donorAtLogistics(page, /^นำมาส่งด้วยตนเอง$/);
		await expect(windowButton(page, DROPOFF)).toBeEnabled();

		await openSlots(page, 'ผู้บริจาคมาส่งเอง');
		await slot.getByRole('button', { name: 'งดรับ' }).click();
		await expect(slot.getByRole('button', { name: 'เปิดรับ' })).toBeVisible();

		await donorAtLogistics(page, /^นำมาส่งด้วยตนเอง$/);
		await expect(windowButton(page, DROPOFF)).toBeDisabled();
		await expect(windowButton(page, DROPOFF)).not.toHaveAccessibleName(/ว่าง/);

		// Reopen — the window is bookable again.
		await openSlots(page, 'ผู้บริจาคมาส่งเอง');
		await slot.getByRole('button', { name: 'เปิดรับ' }).click();
		await expect(slot.getByRole('button', { name: 'งดรับ' })).toBeVisible();
		await donorAtLogistics(page, /^นำมาส่งด้วยตนเอง$/);
		await expect(windowButton(page, DROPOFF)).toBeEnabled();
		await expect(windowButton(page, DROPOFF)).toHaveAccessibleName(/ว่าง/);
	});

	test('staff edit a window (end, ceiling, note), then delete it while nobody has booked it', async ({
		page
	}) => {
		await openSlots(page, 'ผู้บริจาคมาส่งเอง');
		const original = await addSlot(page, CAPPED);
		await expect(original).toContainText('ไม่จำกัด');

		// Edit: the start is the window's identity, so only end / ceiling / note move.
		const [h, m] = CAPPED.from.split(':').map(Number);
		const endMin = h * 60 + m + 15;
		const newTo = `${String(Math.floor(endMin / 60)).padStart(2, '0')}:${String(endMin % 60).padStart(2, '0')}`;
		const note = `ประตู 2 (e2e ${RUN_ID})`;
		await original.getByRole('button', { name: 'แก้ไข' }).click();
		const dialog = page.getByRole('dialog', { name: new RegExp(`^แก้ไขช่วง ${CAPPED.from}`) });
		await dialog.locator('#edit-slot-to').fill(newTo);
		await dialog.locator('#edit-slot-capacity').fill('2');
		await dialog.locator('#edit-slot-note').fill(note);
		await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
		await expect(page.getByText(`แก้ไขช่วง ${CAPPED.from} - ${newTo} แล้ว`)).toBeVisible();
		await expect(dialog).toBeHidden();

		const edited = slotRow(page, { from: CAPPED.from, to: newTo });
		await expect(edited).toContainText('จองแล้ว 0 / 2 คิว');
		await expect(edited).toContainText('ประตู 2');

		// Lift the ceiling again from the same dialog.
		await edited.getByRole('button', { name: 'แก้ไข' }).click();
		await dialog.locator('#edit-slot-capacity').fill('');
		await dialog.getByRole('button', { name: 'บันทึกการแก้ไข' }).click();
		await expect(edited).toContainText('ไม่จำกัด');

		// Same start again → refused; still one row for it.
		await page.locator('#slot-from').fill(CAPPED.from);
		await page.locator('#slot-to').fill(CAPPED.to);
		await page.getByRole('button', { name: 'เพิ่มช่วงเวลา' }).click();
		await expect(page.getByText(`มีช่วงเวลา ${CAPPED.from} ของวันนี้อยู่แล้ว`)).toBeVisible();
		await expect(edited).toHaveCount(1);

		// Nobody booked it → delete is offered, behind a confirmation.
		await edited.getByRole('button', { name: 'ลบ' }).click();
		const confirm = page.getByRole('alertdialog', { name: new RegExp(`^ลบช่วง ${CAPPED.from}`) });
		await confirm.getByRole('button', { name: 'ยืนยันลบ' }).click();
		await expect(page.getByText(`ลบช่วง ${CAPPED.from} - ${newTo} แล้ว`)).toBeVisible();
		await expect(edited).toHaveCount(0);
		const slotId = `donation_slot:dropoff:${todayYmd()}:${CAPPED.from}`;
		expect(
			(await couchReq('GET', `/${shelterDb(slotShelter.code)}/${encodeURIComponent(slotId)}`))
				.status
		).toBe(404);
	});

	test('another day: no truck until staff open the day (เปิดรอบรถทั้งวัน), then donors see it', async ({
		page
	}) => {
		const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toLocaleDateString('sv-SE');
		const existing = await couchReq('POST', `/${shelterDb(slotShelter.code)}/_find`, {
			selector: { type: 'donation_slot', mode: 'pickup', date: tomorrow },
			limit: 1
		});
		test.skip(
			(existing.data as { docs: unknown[] }).docs.length > 0,
			`${slotShelter.code} already has pickup windows on ${tomorrow}`
		);

		// Donor: tomorrow has no truck — told so, nothing to book.
		await donorAtLogistics(page, /ต้องการให้รถศูนย์ไปรับ/);
		await donorPicksDate(page, tomorrow);
		await expect(page.getByText(/ศูนย์นี้ยังไม่เปิดรอบรถเข้ารับของในวันที่เลือก/)).toBeVisible();
		await expect(page.getByRole('button', { name: 'ยืนยันการจองคิวบริจาค' })).toBeDisabled();

		// …while dropping off yourself falls back to the standard windows.
		await page.getByRole('button', { name: 'นำมาส่งด้วยตนเอง' }).click();
		await expect(page.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ })).toHaveCount(
			5
		);

		// Staff: open tomorrow's truck in one click — it needs a trip count first.
		await openSlots(page, 'รถศูนย์ไปรับ');
		await staffPicksDate(page, tomorrow);
		const standard = page.getByRole('button', { name: 'เปิดรอบรถทั้งวัน' });
		await standard.click();
		await expect(page.getByText('กรอกจำนวนเที่ยวรถก่อน แล้วค่อยกดเปิดทั้งวัน')).toBeVisible();
		await page.locator('#slot-capacity').fill('2');
		await standard.click();
		const rows = page.getByRole('listitem').filter({ hasText: 'จองแล้ว 0 / 2 เที่ยว' });
		await expect(rows).toHaveCount(5);
		await standard.click();
		await expect(page.getByText('วันนี้มีช่วงเวลามาตรฐานครบแล้ว')).toBeVisible();

		// Donor: tomorrow now offers the five trips.
		await donorAtLogistics(page, /ต้องการให้รถศูนย์ไปรับ/);
		await donorPicksDate(page, tomorrow);
		await expect(page.getByRole('button', { name: /^\d{2}:\d{2} - \d{2}:\d{2} ว่าง/ })).toHaveCount(
			5
		);
	});
	test('empty add form is refused with the reason, not raw validation JSON', async ({ page }) => {
		await openSlots(page, 'รถศูนย์ไปรับ');
		const add = page.getByRole('button', { name: 'เพิ่มช่วงเวลา' });
		const toast = page.locator('[data-sonner-toast]').last();

		await page.locator('#slot-from').fill('');
		await page.locator('#slot-to').fill('');
		await add.click();
		await expect(toast).toContainText('เวลาเริ่มต้องเป็นรูปแบบ HH:mm');
		await expect(toast).not.toContainText('[');

		// Times fine, but a truck window needs a trip count.
		await page.locator('#slot-from').fill('09:00');
		await page.locator('#slot-to').fill('10:00');
		await add.click();
		await expect(page.getByText('คิวรถไปรับต้องกำหนดจำนวนเที่ยว')).toBeVisible();
	});

	test('slot form buttons stay inside their card on a desktop screen', async ({ page }) => {
		// Regression: the two form buttons sat side by side from `sm` up, and Button being
		// `shrink-0` pushed the second one out of its card, under the list, unclickable.
		await page.setViewportSize({ width: 1280, height: 720 });
		for (const mode of ['ผู้บริจาคมาส่งเอง', 'รถศูนย์ไปรับ'] as const) {
			await openSlots(page, mode);
			const card = page
				.locator('div')
				.filter({ has: page.getByRole('button', { name: 'เพิ่มช่วงเวลา' }) })
				.filter({ has: page.locator('#slot-date') })
				.last();
			const cardBox = (await card.boundingBox())!;
			for (const name of ['เพิ่มช่วงเวลา', /เปิดรอบรถทั้งวัน|ดึงช่วงมาตรฐานมาแก้/]) {
				const box = (await page.getByRole('button', { name }).boundingBox())!;
				expect(
					box.x + box.width,
					`${mode}: "${name}" ends at x=${Math.round(box.x + box.width)}, card at x=${Math.round(cardBox.x + cardBox.width)}`
				).toBeLessThanOrEqual(cardBox.x + cardBox.width);
			}
		}
	});
});

test.describe('scan station walk-in', () => {
	test('counter walk-in goes straight to received with a ledger row', async ({ page }) => {
		await openBackOffice(page, slotStaff);
		await page.getByRole('button', { name: 'ลงทะเบียน Walk-in' }).click();
		await expect(
			page.getByRole('heading', { name: 'บันทึกข้อมูลบริจาคหน้าเคาน์เตอร์ (Walk-in Register)' })
		).toBeVisible();

		const save = page.getByRole('button', { name: 'บันทึกและตรวจรับพัสดุ' });
		await page
			.getByRole('textbox', { name: 'ชื่อผู้บริจาค/ผู้ติดต่อ *' })
			.fill(`E2E Walk-in ${RUN_ID}`);
		await page.getByRole('textbox', { name: 'เบอร์โทรศัพท์ (ถ้ามี)' }).fill('0801234567');
		await page.getByRole('button', { name: /^เลือกประเภทสิ่งของ/ }).click();
		await page.getByRole('option', { name: /^สบู่ก้อน/ }).click();
		await page.getByRole('textbox', { name: 'จำนวนที่รับจริง *' }).fill('3');
		await page.getByRole('textbox', { name: 'โซนจัดเก็บ (ถ้ามี)' }).fill('A-1');

		const posted = page.waitForResponse(
			(r) => r.url().endsWith('/api/back-office/donations') && r.request().method() === 'POST'
		);
		await save.click();
		const res = await posted;
		const body = (await res.json()) as { success: boolean; error?: string } & Record<
			string,
			unknown
		>;
		expect(body.success, `walk-in failed: ${body.error}`).toBe(true);

		const walkin = await couchReq('POST', `/${shelterDb(slotShelter.code)}/_find`, {
			selector: { type: 'donation', 'donor.name': `E2E Walk-in ${RUN_ID}` },
			limit: 1
		});
		const doc = (walkin.data as { docs: Record<string, unknown>[] }).docs[0];
		expect(doc, 'walk-in donation doc').toBeTruthy();
		expect(doc.status).toBe('received');
		expect(doc.channel ?? doc.source).toMatch(/walk/);
		const soap = await catalogItem('สบู่ก้อน');
		expect(await ledgerRowsFor(slotShelter.code, doc._id as string)).toEqual([
			expect.objectContaining({ item_id: soap.id, qty: '3' })
		]);
		expect(await findDonation(slotShelter.code, doc.booking_ref as string)).toBeTruthy();
	});
});
