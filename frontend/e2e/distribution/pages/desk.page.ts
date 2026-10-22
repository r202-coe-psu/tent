/**
 * Page object for the Distribution Desk (`/onsite/distribution`, Station 4).
 *
 * Selectors follow what the UI exposes today — roles, accessible names, labels
 * and element ids (the feature has no `data-testid`). Tab buttons include their
 * badge text in the accessible name, so tabs are matched by a leading regex.
 */

import { expect, type Locator, type Page } from '@playwright/test';
import type { SeededRecipient, SeededTicket, SeededVolunteer } from '../distribution';

export type DeskTab = 'receive' | 'food' | 'supplies' | 'returns' | 'reconciliation';

const TAB_NAME: Record<DeskTab, RegExp> = {
	receive: /^1\. รับของถึงจุดแจก/,
	food: /^2\. แจกอาหารปรุงสุก/,
	supplies: /^3\. จ่ายพัสดุ/,
	returns: /^4\. รับคืนสิ่งของ/,
	reconciliation: /^5\. ปิดรอบ/
};

const TICKET_SELECT_LABEL: Partial<Record<DeskTab, string>> = {
	food: 'เลือกตั๋วอาหารที่ใช้งาน',
	supplies: 'เลือกตั๋วพัสดุที่ใช้งาน',
	reconciliation: 'เลือกตั๋วที่ต้องการปิดรอบหรือกระทบยอด'
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

	async openTab(tab: DeskTab): Promise<void> {
		await this.tab(tab).click();
	}

	/** Restrict tabs 2/3/5 to one distribution point (the scenario's own). */
	async selectPoint(point: string): Promise<void> {
		const trigger = this.page.getByLabel('เลือกจุดแจก');
		await trigger.click();
		await this.page.getByRole('option', { name: point, exact: true }).click();
		await expect(trigger).toContainText(point);
	}

	/** Pick a ticket in the active tab's selector (rendered only when there are 2+ tickets). */
	async selectTicket(tab: DeskTab, ticket: SeededTicket): Promise<void> {
		const label = TICKET_SELECT_LABEL[tab];
		if (!label) throw new Error(`Tab ${tab} has no ticket selector`);
		const selector = this.page.getByLabel(label);
		if ((await selector.count()) === 0) return;
		await selector.click();
		await this.page
			.getByRole('option', { name: new RegExp(escapeRegExp(ticket.ticketNo)) })
			.click();
		await expect(selector).toContainText(ticket.ticketNo);
	}

	// ── Tab 1 ────────────────────────────────────────────────────────────────

	/** IN_TRANSIT ticket card on the receive tab. */
	receiveCard(ticket: SeededTicket): Locator {
		return this.page
			.getByText(ticket.ticketNo, { exact: true })
			.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
	}

	async receive(ticket: SeededTicket): Promise<void> {
		await this.openTab('receive');
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

	bulkDialog(): Locator {
		return this.page.getByRole('dialog', { name: /จับคู่รายการยืมกับกองรับคืน/ });
	}

	// ── Tab 5 ────────────────────────────────────────────────────────────────

	reconciliationHeading(ticket: SeededTicket): Locator {
		return this.page.getByRole('heading', {
			name: new RegExp(`ใบเบิก ${escapeRegExp(ticket.ticketNo)}`)
		});
	}

	reconciliationCard(ticket: SeededTicket): Locator {
		return this.reconciliationHeading(ticket).locator(
			'xpath=ancestor::div[contains(@class, "rounded-2xl")][1]'
		);
	}

	returnQtyInput(itemName: string): Locator {
		return this.page.getByLabel(`จำนวนส่งคืน ${itemName}`);
	}

	async closeShift(returns: Record<string, string>): Promise<void> {
		for (const [itemName, qty] of Object.entries(returns)) {
			await this.returnQtyInput(itemName).fill(qty);
		}
		await this.page.getByRole('button', { name: /ยืนยันปิดรอบแจกจ่าย/ }).click();
	}
}
