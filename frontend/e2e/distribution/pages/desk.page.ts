/**
 * Page object for the Distribution Desk (`/onsite/distribution`, Station 4).
 *
 * Selectors follow what the UI exposes today — roles, accessible names, labels
 * and element ids (the feature has no `data-testid`). Tab buttons include their
 * badge text in the accessible name, so tabs are matched by a leading regex.
 *
 * The desk has two modes (food | supplies) and each mode numbers its own steps, so tabs are
 * matched by label text with any step number. Opening a step that belongs to the other mode
 * switches mode first; `receive` / `reconciliation` exist in both and stay in the current mode.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { SeededRecipient, SeededTicket, SeededVolunteer } from '../distribution';

export type DeskTab = 'receive' | 'food' | 'supplies' | 'returns' | 'reconciliation';
export type DeskMode = 'food' | 'supplies';

const TAB_NAME: Record<DeskTab, RegExp> = {
	receive: /^\d\. รับของถึงจุดแจก/,
	food: /^\d\. แจกอาหารปรุงสุก/,
	supplies: /^\d\. จ่ายพัสดุ/,
	returns: /^\d\. รับคืนสิ่งของ/,
	reconciliation: /^\d\. ปิดรอบ/
};

const TAB_MODE: Partial<Record<DeskTab, DeskMode>> = {
	food: 'food',
	supplies: 'supplies',
	returns: 'supplies'
};

const MODE_NAME: Record<DeskMode, RegExp> = {
	food: /^อาหาร/,
	supplies: /^สิ่งของ/
};

/** Trigger id of each tab's searchable ticket picker (TicketPicker). */
const TICKET_PICKER_ID: Partial<Record<DeskTab, string>> = {
	food: 'food-ticket',
	supplies: 'supplies-ticket',
	reconciliation: 'reconciliation-ticket'
};

export function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export class DeskPage {
	constructor(readonly page: Page) {}

	async goto(): Promise<void> {
		await this.page.goto('/onsite/distribution');
		await expect(this.page.getByRole('heading', { name: /จุดแจกจ่ายพัสดุและอาหาร/ })).toBeVisible();
	}

	tab(tab: DeskTab): Locator {
		return this.page.getByRole('button', { name: TAB_NAME[tab] });
	}

	modeButton(mode: DeskMode): Locator {
		return this.page
			.getByRole('group', { name: 'โหมดงานของโต๊ะแจก' })
			.getByRole('button', { name: MODE_NAME[mode] });
	}

	async switchMode(mode: DeskMode): Promise<void> {
		const button = this.modeButton(mode);
		if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click();
		await expect(button).toHaveAttribute('aria-pressed', 'true');
	}

	/** `mode` is only needed for `receive` / `reconciliation` of the non-default (food) mode. */
	async openTab(tab: DeskTab, mode: DeskMode | undefined = TAB_MODE[tab]): Promise<void> {
		if (mode) await this.switchMode(mode);
		await this.tab(tab).click();
	}

	/** Restrict tabs 2/3/5 to one distribution point (the scenario's own). */
	async selectPoint(point: string): Promise<void> {
		const trigger = this.page.locator('#point-select');
		// Open with the keyboard: a mouse click's pointerup can land on an option of the list
		// before bits-ui positions it (long point lists in a full run) and select that option.
		await trigger.focus();
		await trigger.press('Enter');
		const listbox = this.page.getByRole('listbox');
		await expect(listbox).toBeVisible();
		await listbox.getByRole('option', { name: point, exact: true }).click();
		await expect(trigger).toContainText(point);
	}

	/** The open ticket picker's popover (shadcn popover content; it has no dialog role). */
	ticketPickerPopover(): Locator {
		return this.page
			.locator('[data-slot="popover-content"]')
			.filter({ has: this.page.getByRole('searchbox', { name: /^ค้นหาตั๋ว/ }) });
	}

	/**
	 * Pick a ticket in the active tab's picker (rendered only when there are 2+ tickets). On the
	 * close-out tab the ticket may sit in another status group, so each group is tried in turn.
	 */
	async selectTicket(tab: DeskTab, ticket: SeededTicket): Promise<void> {
		const id = TICKET_PICKER_ID[tab];
		if (!id) throw new Error(`Tab ${tab} has no ticket picker`);
		if (tab !== 'reconciliation') {
			await this.pickInPicker(id, ticket);
			return;
		}
		if (await this.reconciliationCard(ticket).isVisible()) return;
		const groups = this.page.getByRole('group', { name: 'สถานะตั๋ว' }).getByRole('button');
		for (let i = 0; i < (await groups.count()); i += 1) {
			const group = groups.nth(i);
			if (await group.isDisabled()) continue;
			await group.click();
			if (await this.reconciliationCard(ticket).isVisible()) return;
			if (await this.pickInPicker(id, ticket)) return;
		}
		await expect(this.reconciliationCard(ticket)).toBeVisible();
	}

	/** Search the picker for the ticket number and pick it; false when it is not listed. */
	private async pickInPicker(id: string, ticket: SeededTicket): Promise<boolean> {
		const trigger = this.page.locator(`#${id}`);
		if ((await trigger.count()) === 0) return false;
		await trigger.click();
		const popover = this.ticketPickerPopover();
		await popover.getByRole('searchbox').fill(ticket.ticketNo);
		const option = popover.getByRole('button', {
			name: new RegExp(escapeRegExp(ticket.ticketNo))
		});
		if ((await option.count()) === 0) {
			await this.page.keyboard.press('Escape');
			return false;
		}
		await option.click();
		await expect(trigger).toContainText(ticket.ticketNo);
		return true;
	}

	// ── Tab 1 ────────────────────────────────────────────────────────────────

	/** IN_TRANSIT ticket card on the receive tab. */
	receiveCard(ticket: SeededTicket): Locator {
		return this.page
			.getByText(ticket.ticketNo, { exact: true })
			.locator('xpath=ancestor::article[1]');
	}

	async receive(ticket: SeededTicket): Promise<void> {
		await this.openTab('receive', ticket.type);
		await this.receiveCard(ticket)
			.getByRole('button', { name: /ตรวจรับเข้าจุดแจก/ })
			.click();
		await expect(
			this.toast(new RegExp(`ตรวจรับสินค้าเข้าจุดแจกจ่ายเรียบร้อยแล้ว: ${ticket.ticketNo}`))
		).toBeVisible();
	}

	// ── Shared handover controls (tabs 2–4) ──────────────────────────────────

	/** Item button on the food / supplies card (`aria-pressed` toggle). */
	itemButton(itemName: string): Locator {
		return this.page.getByRole('button', { name: new RegExp(escapeRegExp(itemName)) });
	}

	selectedRecipientCard(recipient: SeededRecipient): Locator {
		return this.page
			.getByText(recipient.recipientId, { exact: true })
			.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
	}

	async chooseRecipientBySearch(recipient: SeededRecipient): Promise<void> {
		const search = this.page.locator('#recipient-search-input');
		const change = this.page.getByRole('button', { name: 'เปลี่ยนผู้รับ' });
		if ((await search.count()) === 0 && (await change.count()) > 0) await change.click();
		await expect(search).toBeVisible();
		await search.fill(recipient.firstName);
		await this.page
			.getByRole('button', {
				name: new RegExp(
					`${escapeRegExp(recipient.firstName)}.*${escapeRegExp(recipient.lastName)}`
				)
			})
			.click();
		await expect(this.selectedRecipientCard(recipient)).toBeVisible();
	}

	/** A selected volunteer shows its `V-{NNN}` code, not its doc id (RecipientSearchPicker). */
	selectedVolunteerCard(volunteer: SeededVolunteer): Locator {
		return this.page
			.getByText(`จิตอาสา · ${volunteer.volunteerCode}`, { exact: true })
			.locator('xpath=ancestor::div[contains(@class, "rounded-lg")][1]');
	}

	async chooseVolunteerBySearch(volunteer: SeededVolunteer): Promise<void> {
		const search = this.page.locator('#recipient-search-input');
		const change = this.page.getByRole('button', { name: 'เปลี่ยนผู้รับ' });
		if ((await search.count()) === 0 && (await change.count()) > 0) await change.click();
		await expect(search).toBeVisible();
		await search.fill(volunteer.firstName);
		await this.page
			.getByRole('button', { name: new RegExp(escapeRegExp(volunteer.volunteerCode)) })
			.click();
		await expect(this.selectedVolunteerCard(volunteer)).toBeVisible();
	}

	scannerDialog(): Locator {
		return this.page.getByRole('dialog').filter({ has: this.page.locator('#camera-code-manual') });
	}

	/** Scan-first path through the manual code box (same path as a barcode gun). */
	async chooseRecipientByScan(code: string): Promise<void> {
		await this.page.getByRole('button', { name: /สแกน QR ผู้รับ/ }).click();
		const dialog = this.scannerDialog();
		await expect(dialog).toBeVisible();
		await dialog.locator('#camera-code-manual').fill(code);
		await dialog.getByRole('button', { name: 'ตกลง' }).click();
	}

	async chooseOutsideRecipient(notes?: string): Promise<void> {
		await this.page.getByRole('button', { name: 'บุคคลภายนอก' }).click();
		if (notes) await this.page.locator('#outside-notes').fill(notes);
	}

	alert(text: string | RegExp): Locator {
		return this.page.getByRole('alert').filter({ hasText: text });
	}

	toast(text: string | RegExp): Locator {
		return this.page.locator('[data-sonner-toast]').filter({ hasText: text });
	}

	// ── Tab 2 ────────────────────────────────────────────────────────────────

	foodSubmit(): Locator {
		return this.page.getByRole('button', { name: /^ยืนยันแจก / });
	}

	async fillFoodQty(qty: string): Promise<void> {
		await this.page.locator('#food-qty-input').fill(qty);
	}

	overrideDialog(): Locator {
		return this.page.getByRole('alertdialog', { name: /^แจ้งเตือน:/ });
	}

	/** Confirm the override; the dialog must refuse an unticked confirmation first. */
	async confirmOverride(reason: string): Promise<void> {
		const dialog = this.overrideDialog();
		await expect(dialog).toBeVisible();
		const confirm = dialog.getByRole('button', { name: 'บันทึกแจกแบบมีเหตุผล' });
		await confirm.click();
		await expect(dialog.getByText('กรุณากดยืนยันการแจกเป็นกรณีพิเศษ')).toBeVisible();
		await dialog.getByRole('checkbox').click();
		await dialog.locator('#override-reason-input').fill(reason);
		await confirm.click();
		await expect(dialog).toBeHidden();
	}

	// ── Tab 3 ────────────────────────────────────────────────────────────────

	async fillSuppliesQty(qty: string): Promise<void> {
		const input = this.page.locator('#supplies-qty-input');
		await input.fill(qty);
		await expect(input).toHaveValue(qty);
	}

	suppliesSubmit(kind: 'consumable' | 'loan'): Locator {
		return this.page.getByRole('button', {
			name: kind === 'loan' ? 'ยืนยันบันทึกการยืมสิ่งของ' : 'ยืนยันบันทึกแจกจ่ายพัสดุ'
		});
	}

	// ── Tab 4 ────────────────────────────────────────────────────────────────

	loanCard(itemName: string): Locator {
		return this.page
			.getByText(itemName, { exact: true })
			.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
	}

	async returnPhysical(itemName: string, qty: string, condition?: RegExp): Promise<void> {
		await this.loanCard(itemName).getByRole('button', { name: 'รับคืนจากผู้ยืม' }).click();
		const dialog = this.page.getByRole('dialog', { name: /ตรวจรับคืนพัสดุเข้าคลัง/ });
		await dialog.getByLabel(/จำนวนที่ตรวจรับคืนครั้งนี้/).fill(qty);
		if (condition) {
			await dialog.getByLabel('สภาพพัสดุที่รับคืน').click();
			await this.page.getByRole('option', { name: condition }).click();
		}
		await dialog.getByRole('button', { name: /ยืนยันตรวจรับคืนเข้าคลัง/ }).click();
		await expect(dialog).toBeHidden();
	}

	nonPhysicalDialog(): Locator {
		return this.page.getByRole('dialog', { name: /ตัดจำหน่ายรายการโดยไม่มีของคืน/ });
	}

	// ── Tab 5 ────────────────────────────────────────────────────────────────

	/** The close-out card, a region named after its ticket number. */
	reconciliationCard(ticket: SeededTicket): Locator {
		return this.page.getByRole('region', {
			name: new RegExp(`เลขตั๋ว ${escapeRegExp(ticket.ticketNo)}`)
		});
	}

	returnQtyInput(itemName: string): Locator {
		// The card renders a phone and a table layout; only one is visible. Match the accessible
		// name ("จำนวนส่งคืน {item} ({unit})"): the label is visible text plus an sr-only item name.
		return this.page
			.getByRole('textbox', { name: new RegExp(`^จำนวนส่งคืน ${escapeRegExp(itemName)}`) })
			.filter({ visible: true });
	}

	async closeShift(returns: Record<string, string>): Promise<void> {
		for (const [itemName, qty] of Object.entries(returns)) {
			await this.returnQtyInput(itemName).fill(qty);
		}
		await this.page.getByRole('button', { name: /ยืนยันปิดรอบแจกจ่าย/ }).click();
	}
}
