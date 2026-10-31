/**
 * Page object for back-office Distribution (`/back-office/distribution`):
 * create → allocate → approve → dispatch, and the warehouse return receipt.
 */

import { expect, type Page } from '@playwright/test';
import type { SeededItem, SeededTicket } from '../distribution';
import { findShelterDocuments, getShelterDocument } from '../distribution';
import { expectTicketStatus } from '../checks';

export class BackOfficePage {
	constructor(readonly page: Page) {}

	async gotoTicket(ticket: SeededTicket): Promise<void> {
		await this.page.goto(
			`/back-office/distribution?ticketId=${encodeURIComponent(ticket.ticketId)}`
		);
	}

	async createSuppliesTicket(
		item: SeededItem,
		requestedQty: string,
		destination: string,
		createdBy: string
	): Promise<SeededTicket> {
		const page = this.page;
		await page.goto('/back-office/distribution');
		await expect(page.getByRole('heading', { name: 'ระบบเบิกจ่ายพัสดุและอาหาร' })).toBeVisible();
		await page.getByRole('link', { name: 'สร้างใบเบิกจ่าย' }).click();
		await expect(page).toHaveURL(/\/back-office\/distribution\/new/);
		await expect(page.getByRole('heading', { name: /สร้างใบเบิกจ่ายพัสดุและอาหาร/ })).toBeVisible();
		await page.getByRole('radio', { name: /พัสดุและสิ่งของ/ }).click();
		await page.getByLabel(/จุดหมายปลายทาง/).click();
		await page.getByRole('option', { name: /ระบุจุดหมายอื่น/ }).click();
		await page.getByPlaceholder(/พิมพ์ชื่อจุดหมายปลายทางที่ต้องการ/).fill(destination);
		// The catalog picker is inline on the page (no nested dialog).
		const picker = page.getByRole('region', { name: /เลือกรายการพัสดุ/ });
		await picker.getByLabel(/ค้นหาชื่อรายการ/).fill(item.name);
		await picker.getByLabel(/จำนวนที่ต้องการเบิก/).fill(requestedQty);
		await picker.getByRole('button', { name: 'เลือก' }).click();
		await page.getByRole('button', { name: 'ยืนยันสร้างใบเบิกจ่าย' }).click();
		// Scoped to the Sonner toast container; the app then returns to the ticket list.
		await expect(
			page.locator('[data-sonner-toast]').filter({ hasText: /สร้างใบเบิกจ่าย.*สำเร็จ/ })
		).toBeVisible();
		await expect(page).toHaveURL(/\/back-office\/distribution(\?|$)/);

		let ticketId = '';
		await expect
			.poll(
				async () => {
					const tickets = await findShelterDocuments(
						(doc) =>
							doc.type === 'requisition_ticket' &&
							doc.created_by === createdBy &&
							Array.isArray(doc.items) &&
							doc.items.some(
								(entry) =>
									!!entry &&
									typeof entry === 'object' &&
									(entry as { item_id?: unknown }).item_id === item.itemId
							)
					);
					ticketId = tickets[0]?._id ?? '';
					return ticketId;
				},
				{ message: `Created ticket for ${item.name} was not persisted` }
			)
			.toMatch(/^requisition_ticket:/);
		const ticket = await getShelterDocument(ticketId);
		if (!ticket || typeof ticket.ticket_no !== 'string') {
			throw new Error(`Created ticket ${ticketId} was not readable`);
		}
		return { ticketId, ticketNo: ticket.ticket_no, type: 'supplies' };
	}

	async allocate(ticket: SeededTicket, item: SeededItem, qty: string): Promise<void> {
		await this.gotoTicket(ticket);
		const before = await getShelterDocument(ticket.ticketId);
		if (!before?._rev) throw new Error(`Allocation could not read revision for ${ticket.ticketNo}`);

		await this.page.getByRole('button', { name: 'จัดสรรยอดสินค้า' }).click();
		const allocation = this.page.getByRole('dialog', { name: /จัดสรรยอดสินค้า/ });
		await allocation.getByLabel(`ยอดจัดสรร ${item.name}`).fill(qty);
		await allocation.getByRole('button', { name: 'บันทึกการจัดสรร' }).click();
		await expect(allocation).toBeHidden();

		await expect
			.poll(
				async () => {
					const doc = await getShelterDocument(ticket.ticketId);
					if (doc?._rev === before._rev) return undefined;
					const items = (doc?.items ?? []) as Array<{ item_id?: string; allocated_qty?: string }>;
					return items.find((i) => i.item_id === item.itemId)?.allocated_qty;
				},
				{ message: `Allocation did not set allocated_qty to ${qty} for ${ticket.ticketNo}` }
			)
			.toBe(qty);
	}

	async approve(ticket: SeededTicket): Promise<void> {
		await this.page.getByRole('button', { name: 'อนุมัติให้ปล่อยของ' }).click();
		await this.page
			.getByRole('dialog', { name: /ยืนยันการอนุมัติปล่อยของ/ })
			.getByRole('button', { name: 'ยืนยันอนุมัติ' })
			.click();
		await expectTicketStatus(ticket, 'READY_FOR_DISPATCH', 'Approval checkpoint');
	}

	async dispatch(ticket: SeededTicket, item: SeededItem): Promise<void> {
		await this.page.getByRole('button', { name: /เลือก Physical Lot และปล่อยรถ/ }).click();
		const dialog = this.page.getByRole('dialog', { name: /เลือก Physical Lot และปล่อยรถ/ });
		// Wait for the lot list (lots loaded), then let the picker fill qty per lot.
		await expect(
			dialog.getByRole('list', { name: `กำหนดจำนวนจาก Physical Lot สินค้าสำหรับ ${item.name}` })
		).toBeVisible();
		await dialog.getByRole('button', { name: 'จัดสรรอัตโนมัติ' }).click();
		const confirm = dialog.getByRole('button', { name: /ยืนยันปล่อยรถ/ });
		await expect(confirm).toBeEnabled();
		await confirm.click();
		await expectTicketStatus(ticket, 'IN_TRANSIT', 'Dispatch checkpoint');
	}

	/** Warehouse return receipt: `invalidQty` (above declared) must keep the confirm disabled. */
	async receiveWarehouseReturn(
		ticket: SeededTicket,
		item: SeededItem,
		verifiedQty: string,
		invalidQty?: string
	): Promise<void> {
		await this.gotoTicket(ticket);
		await this.page.getByRole('button', { name: /ตรวจรับของคืนเข้าคลังสินค้า/ }).click();
		const dialog = this.page.getByRole('dialog', { name: /ตรวจรับของคืนเข้าคลังสินค้า/ });
		const verified = dialog.getByLabel(`จำนวนตรวจรับจริง ${item.name}`);
		const confirm = dialog.getByRole('button', { name: /ยืนยันตรวจรับเข้าสต็อกคลัง/ });
		if (invalidQty) {
			await verified.fill(invalidQty);
			await expect(confirm).toBeDisabled();
		}
		await verified.fill(verifiedQty);
		await confirm.click();
		await expectTicketStatus(ticket, 'RETURN_COMPLETED', 'Warehouse receipt checkpoint');
		await expect(this.page.getByText('ตรวจรับคืนเรียบร้อยแล้ว', { exact: true })).toBeVisible();
	}

	async completeTicket(ticket: SeededTicket): Promise<void> {
		await this.page.getByRole('button', { name: /ปิดตั๋วใบเบิกจ่าย/ }).click();
		const dialog = this.page.getByRole('dialog', { name: 'ยืนยันการปิดตั๋วใบเบิกจ่าย' });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'ยืนยันปิดตั๋ว' }).click();
		await expectTicketStatus(ticket, 'COMPLETED', 'Ticket-completion checkpoint');
	}

	async expectCompletedInBrowser(ticket: SeededTicket): Promise<void> {
		await this.gotoTicket(ticket);
		const detail = this.page.getByRole('dialog', { name: ticket.ticketNo });
		await expect(detail).toBeVisible();
		const progress = detail.getByLabel('ขั้นตอนความคืบหน้าของตั๋วเบิกจ่าย');
		await expect(progress.getByText('เสร็จสมบูรณ์', { exact: true })).toBeVisible();
	}
}
