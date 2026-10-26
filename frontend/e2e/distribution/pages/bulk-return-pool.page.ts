/**
 * Page object for the bulk return pool v3 board (`BulkReturnPoolBoard`), which sits on both staff
 * surfaces: back-office (`/back-office/distribution`, tab "กองรับคืนพัสดุ") and the onsite desk
 * (`/onsite/distribution`, tab "4. รับคืนสิ่งของ", under `LoanReturnCard`).
 *
 * The feature has no `data-testid`: locators are roles, accessible names and element ids, and every
 * Thai string lives in `POOL_COPY` so a copy change is one edit. Pool names are unique per scenario,
 * so a pool is found by name; the shared E2E shelter may hold other tests' pools.
 *
 * Which controls a viewer sees depends on the session (`canManage` / `canWriteEntry`), not on the
 * surface — assert absence with `toHaveCount(0)`.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { SeededItem, SeededRecipient } from '../distribution';
import { DeskPage, escapeRegExp } from './desk.page';

export const POOL_COPY = {
	boardHeading: 'กองรับคืน',
	backOfficeHeading: 'ระบบเบิกจ่ายพัสดุและอาหาร',
	backOfficeTab: 'กองรับคืนพัสดุ',
	showCancelledToggle: '#bulk-pool-show-cancelled',

	dialogCancel: 'ยกเลิก',

	// open / edit
	openNew: 'เปิดกองใหม่',
	openSubmit: 'เปิดกอง',
	editHeader: 'แก้ไขข้อมูลกอง',
	editSave: 'บันทึก',
	nameTakenError: 'มีกองที่เปิดรับอยู่ใช้ชื่อนี้แล้ว กรุณาตั้งชื่ออื่น',
	nameDuplicateWarning: 'มีกองที่เปิดรับอยู่ใช้ชื่อนี้แล้ว ควรตั้งชื่ออื่นเพื่อไม่ให้สับสน',

	// add entries
	addEntries: 'รับของเข้ากอง',
	addLine: 'เพิ่มรายการสินค้า',
	saveEntries: 'บันทึกเข้ากอง',
	loanCardAction: 'คืนเข้ากองรับคืน',
	noLoanWarning: 'ผู้คืนรายนี้ไม่มีรายการยืมค้าง — บันทึกเข้ากองได้ แต่จะไม่ตัดยอดยืม',

	// entries
	move: 'ย้ายไปกองอื่น',
	moveConfirm: 'ย้ายรายการ',
	voidEntry: 'ยกเลิกรายการ',
	voidDialog: 'ยืนยันการยกเลิกรายการ',
	voidConfirm: 'ยืนยันยกเลิกรายการ',
	lateNotice: 'รายการนี้เข้ามาหลังกองปิดรับแล้ว',
	lateBadge: 'ค้าง',
	lateCardExcluded: 'ไม่รวมในยอดที่เก็บเข้าคลัง',
	lateItemQty: 'รวมของค้าง',
	voidToastNoRevert: 'ยกเลิกรายการแล้ว (รายการนี้ไม่ได้ตัดยอดยืม จึงไม่มียอดยืมต้องคืนสถานะ)',
	voidToastReverted: 'คืนสถานะยอดยืม',
	entryNoLoanApplied: 'ไม่ได้ตัดยอดยืม',
	noEntries: 'ยังไม่มีรายการในกองนี้',
	itemsSummaryHeading: 'สรุปรายการสินค้าในกอง',
	// loan drift: a ref skipped at apply because its loan was already closed (read-time warning)
	closedLoanWarningTestId: 'bulk-return-entry-closed-loan-warning',
	closedLoanWarning: 'ยอดยืมใบนี้ถูกปิดไปก่อนที่ของจะเข้ากอง',

	// lifecycle
	submit: 'เก็บเข้าคลัง',
	submitDialog: 'ยืนยันเก็บกองเข้าคลัง',
	submitConfirm: 'ยืนยันเก็บเข้าคลัง',
	submitEmptyReason: 'กองนี้ยังไม่มีรายการ ส่งเข้าคลังไม่ได้ — ยกเลิกกองแทน',
	receive: 'ตรวจรับ',
	receiveDialog: 'ตรวจรับกอง',
	receiveConfirm: 'ยืนยันตรวจรับ',
	receiveRecord: 'ผลการตรวจรับ',
	storageRequired: 'เลือกจุดเก็บของ',
	cancelPool: 'ยกเลิกกอง',
	cancelDialog: 'ยืนยันการยกเลิกกอง',
	cancelConfirm: 'ยืนยันยกเลิกกอง',
	cancelNotEmptyReason: 'ย้ายของออกให้หมดก่อน',

	// labels
	status: {
		OPEN: 'เปิดรับ',
		SUBMITTED: 'ส่งแล้ว',
		RECEIVED: 'ตรวจรับแล้ว',
		CANCELLED: 'ยกเลิก'
	},
	unspecifiedLocation: 'ไม่ระบุ',
	mainStore: 'คลังหลัก',
	unspecifiedPointOption: 'ไม่ระบุ (คลังหลัก)',
	reasons: { damaged: 'ชำรุด', missing: 'สูญหาย', miscount: 'นับผิด', other: 'อื่น ๆ' }
} as const;

export type PoolStatus = keyof typeof POOL_COPY.status;
export type DiscrepancyReason = keyof typeof POOL_COPY.reasons;

export type PoolReturner = SeededRecipient | 'unspecified' | 'prefilled';

export interface AddEntryLine {
	/** Omit to keep the item the dialog was prefilled with (`LoanReturnCard` path). */
	item?: SeededItem;
	qty: string;
}

export interface AddEntriesOptions {
	/** Pool name to pick; omit to keep the pool the dialog was opened for. */
	pool?: string;
	/** `prefilled` (default) keeps the returner the dialog arrived with. */
	returner?: PoolReturner;
	lines: AddEntryLine[];
}

/** Excludes the board's role work-queue rows, which also name pools (Phase 2). */
const NOT_IN_WORK_QUEUE = ':not([data-testid="bulk-return-work-queues"] *)';

export class BulkReturnPoolBoard {
	constructor(readonly page: Page) {}

	// ── Reaching the board ───────────────────────────────────────────────────────────────────

	/** Back-office: tab "กองรับคืนพัสดุ" (no URL param). */
	async gotoBackOffice(): Promise<void> {
		await this.page.goto('/back-office/distribution');
		await expect(
			this.page.getByRole('heading', { name: POOL_COPY.backOfficeHeading })
		).toBeVisible();
		await this.page.getByRole('tab', { name: POOL_COPY.backOfficeTab }).click();
		await expect(this.heading()).toBeVisible();
	}

	/** Onsite desk: tab "4. รับคืนสิ่งของ". Returns the desk page object for the caller. */
	async gotoDesk(): Promise<DeskPage> {
		const desk = new DeskPage(this.page);
		await desk.goto();
		await desk.openTab('returns');
		await expect(this.heading()).toBeVisible();
		return desk;
	}

	heading(): Locator {
		return this.page.getByRole('heading', { name: POOL_COPY.boardHeading, exact: true });
	}

	/** First matching toast (Sonner stacks them, so a repeated success message is not a strict-mode hit). */
	toast(text: string | RegExp): Locator {
		return this.page.locator('[data-sonner-toast]').filter({ hasText: text }).first();
	}

	/** Board-header button ("เปิดกองใหม่" / "รับของเข้ากอง"); hidden behind the sheet while it is open. */
	headerAction(label: string): Locator {
		return this.page.getByRole('button', { name: label, exact: true });
	}

	// ── List ─────────────────────────────────────────────────────────────────────────────────

	/** A pool card on the board (not the same pool's row in the role work queues above it). */
	card(poolName: string): Locator {
		return this.page
			.getByRole('button', { name: new RegExp(escapeRegExp(poolName)) })
			.and(this.page.locator(NOT_IN_WORK_QUEUE));
	}

	async expectCardStatus(poolName: string, status: PoolStatus): Promise<void> {
		await expect(this.card(poolName)).toContainText(POOL_COPY.status[status]);
	}

	/** Tick / untick "แสดงกองที่ยกเลิก". */
	async showCancelled(on: boolean): Promise<void> {
		const toggle = this.page.locator(POOL_COPY.showCancelledToggle);
		if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
		await expect(toggle).toHaveAttribute('aria-checked', String(on));
	}

	// ── Detail sheet ─────────────────────────────────────────────────────────────────────────

	/** The detail sheet of a pool: a dialog titled with the pool name. */
	detail(poolName: string): Locator {
		return this.page.getByRole('dialog', { name: new RegExp(escapeRegExp(poolName)) });
	}

	async openDetail(poolName: string): Promise<Locator> {
		await this.card(poolName).click();
		const detail = this.detail(poolName);
		await expect(detail).toBeVisible();
		return detail;
	}

	async closeDetail(poolName: string): Promise<void> {
		await this.page.keyboard.press('Escape');
		await expect(this.detail(poolName)).toBeHidden();
	}

	/**
	 * After a mutation done from inside the sheet: the open sheet follows the live overview row, so
	 * just wait on it (no close / reopen). If the sheet is not open (a flow that closed it), wait for
	 * the card to show the new state and open the sheet from it.
	 *
	 * While the sheet is open the board cards sit behind the modal and are not in the accessibility
	 * tree, so card locators are only used on the fallback path.
	 *
	 * @param poolName name the sheet shows now (the NEW name after a rename)
	 * @param options.entryCount fallback path only: wait for the card to show this entry count (best
	 *   effort; the sheet has no count, the spec assertions after are the proof)
	 * @param options.status wait for the sheet (or the card, on the fallback path) to show this status
	 */
	async expectDetail(
		poolName: string,
		options: { entryCount?: number; status?: PoolStatus } = {}
	): Promise<Locator> {
		const detail = this.detail(poolName);
		await detail.waitFor({ state: 'visible', timeout: 3_000 }).catch(() => undefined);
		if (await detail.isVisible()) {
			await expect(detail).toBeVisible();
			if (options.status) await expect(detail).toContainText(POOL_COPY.status[options.status]);
			return detail;
		}
		await expect(this.card(poolName)).toBeVisible();
		if (options.status) await this.expectCardStatus(poolName, options.status);
		if (options.entryCount !== undefined) {
			await expect(this.card(poolName))
				.toContainText(new RegExp(`(?<!\\d)${options.entryCount}\\s*รายการ`), { timeout: 5_000 })
				.catch(() => undefined);
		}
		return this.openDetail(poolName);
	}

	/**
	 * Entry count printed on a pool's board card, read from the DOM even while the sheet hides the
	 * card from the accessibility tree. `undefined` when it cannot be read.
	 */
	private async cardEntryCount(poolName: string): Promise<number | undefined> {
		const card = this.page
			.locator(`ul > li > button${NOT_IN_WORK_QUEUE}`)
			.filter({ hasText: poolName })
			.first();
		const text = (await card.textContent({ timeout: 2_000 }).catch(() => null)) ?? '';
		const match = /(\d+)\s*รายการ/.exec(text);
		return match ? Number(match[1]) : undefined;
	}

	/** A button of the detail sheet by exact accessible name. */
	action(poolName: string, label: string): Locator {
		return this.detail(poolName).getByRole('button', { name: label, exact: true });
	}

	/** One live (non-voided) entry row of the detail sheet, found by item name. */
	entryRow(poolName: string, itemName: string, index = 0): Locator {
		return this.detail(poolName)
			.getByRole('listitem')
			.filter({ hasText: 'ผู้คืน:' })
			.filter({ hasText: itemName })
			.nth(index);
	}

	/** Why submit is unavailable (`aria-describedby` target of the submit button). */
	submitReason(): Locator {
		return this.page.locator('#submit-pool-reason');
	}

	/** Why cancel is unavailable (`aria-describedby` target of the cancel button). */
	cancelReason(): Locator {
		return this.page.locator('#cancel-pool-reason');
	}

	// ── Open / edit ──────────────────────────────────────────────────────────────────────────

	openDialog(): Locator {
		return this.page.getByRole('dialog', { name: POOL_COPY.openNew });
	}

	async startOpenPool(): Promise<Locator> {
		await this.headerAction(POOL_COPY.openNew).click();
		const dialog = this.openDialog();
		await expect(dialog).toBeVisible();
		return dialog;
	}

	/**
	 * Open a pool through the UI. The app opens the new pool's detail sheet by itself after create,
	 * so this waits for it. Returns with the sheet open.
	 */
	async openPool(options: { name: string; location?: string; notes?: string }): Promise<void> {
		const dialog = await this.startOpenPool();
		await dialog.locator('#open-pool-name').fill(options.name);
		if (options.location) {
			await this.choose(dialog.locator('#open-pool-location'), pointOption(options.location));
		}
		if (options.notes) await dialog.locator('#open-pool-notes').fill(options.notes);
		await dialog.getByRole('button', { name: POOL_COPY.openSubmit, exact: true }).click();
		await expect(this.toast(`เปิดกอง "${options.name}" เรียบร้อยแล้ว`)).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(this.detail(options.name)).toBeVisible();
	}

	editDialog(): Locator {
		return this.page.getByRole('dialog', { name: POOL_COPY.editHeader });
	}

	/** Edit name / location of an OPEN pool from its detail sheet (`location: null` clears it). */
	async editHeader(
		poolName: string,
		changes: { name?: string; location?: string | null }
	): Promise<void> {
		await this.action(poolName, POOL_COPY.editHeader).click();
		const dialog = this.editDialog();
		await expect(dialog).toBeVisible();
		if (changes.name !== undefined) await dialog.locator('#edit-pool-name').fill(changes.name);
		if (changes.location === null) {
			await this.choose(dialog.locator('#edit-pool-location'), POOL_COPY.unspecifiedPointOption);
		} else if (changes.location !== undefined) {
			await this.choose(dialog.locator('#edit-pool-location'), pointOption(changes.location));
		}
		await dialog.getByRole('button', { name: POOL_COPY.editSave, exact: true }).click();
		await expect(this.toast('บันทึกข้อมูลกองเรียบร้อยแล้ว')).toBeVisible();
		await expect(dialog).toBeHidden();
		// The open sheet follows the live row, so its title becomes the new name.
		await this.expectDetail(changes.name ?? poolName);
	}

	// ── Add entries ──────────────────────────────────────────────────────────────────────────

	addDialog(): Locator {
		return this.page.getByRole('dialog', { name: POOL_COPY.addEntries });
	}

	/**
	 * The loan card of an item on the desk's tab 4 (heading level 5 = the item name). Do not use
	 * `DeskPage.loanCard` once a pool lists the item: its exact-text match then hits two elements.
	 */
	loanCard(itemName: string): Locator {
		return this.page
			.getByRole('heading', { name: itemName, exact: true, level: 5 })
			.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
	}

	async startAddFromBoard(): Promise<Locator> {
		await this.headerAction(POOL_COPY.addEntries).click();
		return this.addDialogVisible();
	}

	async startAddFromDetail(poolName: string): Promise<Locator> {
		await this.action(poolName, POOL_COPY.addEntries).click();
		return this.addDialogVisible();
	}

	/** Desk tab 4, borrower selected: "คืนเข้ากองรับคืน" opens the dialog prefilled. */
	async startAddFromLoanCard(itemName: string): Promise<Locator> {
		await this.loanCard(itemName).getByRole('button', { name: POOL_COPY.loanCardAction }).click();
		return this.addDialogVisible();
	}

	private async addDialogVisible(): Promise<Locator> {
		const dialog = this.addDialog();
		await expect(dialog).toBeVisible();
		return dialog;
	}

	/** Pick the returner inside the add dialog (`#recipient-search-input` exists twice on tab 4). */
	async pickReturner(dialog: Locator, recipient: SeededRecipient): Promise<void> {
		const first = escapeRegExp(recipient.firstName);
		const last = escapeRegExp(recipient.lastName);
		await dialog.locator('#recipient-search-input').fill(recipient.firstName);
		await dialog.getByRole('button', { name: new RegExp(`${first}.*${last}`) }).click();
		await expect(dialog.getByText(recipient.recipientId, { exact: true })).toBeVisible();
	}

	async fillAddDialog(dialog: Locator, options: AddEntriesOptions): Promise<void> {
		if (options.pool) await this.choose(dialog.locator('#add-entry-pool'), options.pool);
		const returner = options.returner ?? 'prefilled';
		if (returner === 'unspecified') {
			await dialog.locator('#add-entry-unspecified').click();
		} else if (returner !== 'prefilled') {
			await this.pickReturner(dialog, returner);
		}
		for (let index = 0; index < options.lines.length; index++) {
			const line = options.lines[index];
			if (index > 0) await dialog.getByRole('button', { name: POOL_COPY.addLine }).click();
			if (line.item) {
				await this.choose(dialog.locator('[id^="add-entry-item-"]').nth(index), line.item.name);
			}
			await dialog.locator('[id^="add-entry-qty-"]').nth(index).fill(line.qty);
		}
	}

	/** Press "บันทึกเข้ากอง" and wait for the dialog to close (every line written). */
	async saveAddDialog(dialog: Locator): Promise<void> {
		await dialog.getByRole('button', { name: POOL_COPY.saveEntries }).click();
		await expect(this.toast(/บันทึกเข้ากองแล้ว/)).toBeVisible();
		await expect(dialog).toBeHidden();
	}

	async addFromBoard(options: AddEntriesOptions): Promise<void> {
		const dialog = await this.startAddFromBoard();
		await this.fillAddDialog(dialog, options);
		await this.saveAddDialog(dialog);
	}

	/** Add from the open sheet; it follows the live row, so the new rows show without a reopen. */
	async addFromDetail(poolName: string, options: AddEntriesOptions): Promise<void> {
		const before = await this.cardEntryCount(poolName);
		const dialog = await this.startAddFromDetail(poolName);
		await this.fillAddDialog(dialog, options);
		await this.saveAddDialog(dialog);
		const intoThisPool = (options.pool ?? poolName) === poolName;
		await this.expectDetail(poolName, {
			entryCount: before !== undefined && intoThisPool ? before + options.lines.length : undefined
		});
	}

	async addFromLoanCard(itemName: string, options: AddEntriesOptions): Promise<void> {
		const dialog = await this.startAddFromLoanCard(itemName);
		await this.fillAddDialog(dialog, options);
		await this.saveAddDialog(dialog);
	}

	// ── Move / void ──────────────────────────────────────────────────────────────────────────

	moveDialog(): Locator {
		return this.page.getByRole('dialog', { name: POOL_COPY.move });
	}

	/** Move the `index`-th entry of `itemName` from the open detail sheet to `toPool`. */
	async moveEntry(poolName: string, itemName: string, toPool: string, index = 0): Promise<void> {
		const before = await this.cardEntryCount(poolName);
		await this.entryRow(poolName, itemName, index)
			.getByRole('button', { name: POOL_COPY.move })
			.click();
		const dialog = this.moveDialog();
		await expect(dialog).toBeVisible();
		await this.choose(dialog.locator('#move-entry-target'), toPool);
		await dialog.getByRole('button', { name: POOL_COPY.moveConfirm, exact: true }).click();
		await expect(this.toast(/ย้ายรายการไปกอง/)).toBeVisible();
		await expect(dialog).toBeHidden();
		await this.expectDetail(poolName, {
			entryCount: before !== undefined ? before - 1 : undefined
		});
	}

	voidDialog(): Locator {
		return this.page.getByRole('alertdialog', { name: POOL_COPY.voidDialog });
	}

	/** Void the `index`-th entry of `itemName` (append-only void doc; reopens its loans). */
	async voidEntry(poolName: string, itemName: string, index = 0): Promise<void> {
		const before = await this.cardEntryCount(poolName);
		await this.entryRow(poolName, itemName, index)
			.getByRole('button', { name: POOL_COPY.voidEntry })
			.click();
		const dialog = this.voidDialog();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: POOL_COPY.voidConfirm }).click();
		await expect(this.toast('ยกเลิกรายการแล้ว')).toBeVisible();
		await expect(dialog).toBeHidden();
		await this.expectDetail(poolName, {
			entryCount: before !== undefined ? before - 1 : undefined
		});
	}

	// ── Cancel / submit / receive ────────────────────────────────────────────────────────────

	cancelDialog(): Locator {
		return this.page.getByRole('alertdialog', { name: POOL_COPY.cancelDialog });
	}

	/** Cancel an empty OPEN pool; the sheet closes itself afterwards. */
	async cancelPool(poolName: string): Promise<void> {
		await this.action(poolName, POOL_COPY.cancelPool).click();
		const dialog = this.cancelDialog();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: POOL_COPY.cancelConfirm }).click();
		await expect(this.toast('ยกเลิกกองเรียบร้อยแล้ว')).toBeVisible();
		await expect(dialog).toBeHidden();
		// `confirmCancelPool` calls `onClose()`, so the sheet is gone; nothing to reopen.
		await expect(this.detail(poolName)).toBeHidden();
	}

	submitDialog(): Locator {
		return this.page.getByRole('alertdialog', { name: POOL_COPY.submitDialog });
	}

	/** "เก็บเข้าคลัง" → confirm; the open sheet then shows SUBMITTED. */
	async submitPool(poolName: string): Promise<void> {
		await this.action(poolName, POOL_COPY.submit).click();
		const dialog = this.submitDialog();
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: POOL_COPY.submitConfirm }).click();
		await expect(this.toast(/ส่งกองเข้าคลังแล้ว/)).toBeVisible();
		await expect(dialog).toBeHidden();
		await this.expectDetail(poolName, { status: 'SUBMITTED' });
	}

	receiveDialog(): Locator {
		return this.page.getByRole('dialog', { name: POOL_COPY.receiveDialog });
	}

	async openReceive(poolName: string): Promise<Locator> {
		await this.action(poolName, POOL_COPY.receive).click();
		const dialog = this.receiveDialog();
		await expect(dialog).toBeVisible();
		return dialog;
	}

	/** Item ids contain `:`, so these are attribute selectors, not `#id`. */
	receiveQty(dialog: Locator, item: SeededItem): Locator {
		return dialog.locator(`[id="receive-qty-${item.itemId}"]`);
	}

	receiveReason(dialog: Locator, item: SeededItem): Locator {
		return dialog.locator(`[id="receive-reason-${item.itemId}"]`);
	}

	receiveNote(dialog: Locator, item: SeededItem): Locator {
		return dialog.locator(`[id="receive-note-${item.itemId}"]`);
	}

	receiveStorage(dialog: Locator): Locator {
		return dialog.locator('#receive-storage-point');
	}

	async chooseReason(dialog: Locator, item: SeededItem, reason: DiscrepancyReason): Promise<void> {
		await this.choose(this.receiveReason(dialog, item), POOL_COPY.reasons[reason]);
	}

	async chooseReceiveStorage(dialog: Locator, pointName: string): Promise<void> {
		await this.choose(this.receiveStorage(dialog), pointOption(pointName));
	}

	/** "ยืนยันตรวจรับ": success closes the dialog; the open sheet then shows RECEIVED. */
	async confirmReceive(dialog: Locator, poolName: string): Promise<void> {
		await dialog.getByRole('button', { name: POOL_COPY.receiveConfirm, exact: true }).click();
		await expect(this.toast(/ตรวจรับเรียบร้อย/)).toBeVisible();
		await expect(dialog).toBeHidden();
		await this.expectDetail(poolName, { status: 'RECEIVED' });
	}

	// ── Select helper (bits-ui Select: a trigger button + role=option items in a portal) ─────

	private async choose(trigger: Locator, option: string | RegExp): Promise<void> {
		await trigger.click();
		const name = typeof option === 'string' ? { name: option, exact: true } : { name: option };
		await this.page.getByRole('option', name).click();
	}
}

/** Storage point options are labelled `📍 {name}`. */
export function pointOption(pointName: string): RegExp {
	return new RegExp(escapeRegExp(pointName));
}
