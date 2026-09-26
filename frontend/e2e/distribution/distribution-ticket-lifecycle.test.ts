/**
 * Browser journeys against the real E2E CouchDB. Fixtures establish catalog
 * stock only; every ticket, log, and ledger transition is browser-driven.
 */

import { expect, test, type Page } from '@playwright/test';
import { clearSession, injectSession } from '../helpers/login';
import {
	cleanupDistributionScenario,
	createDistributionScenario,
	findShelterDocuments,
	getShelterDocument,
	routeBrowserCouchThroughApp,
	seedItemWithStock,
	type DistributionScenario,
	type SeededItem
} from './distribution';

const REQUESTED_QTY = '120';
const ALLOCATED_QTY = '100';
const DISTRIBUTED_QTY = '80';
const ZERO_RETURN_QTY = '0';
const RETURNED_QTY = '0';
const DISCREPANCY_QTY = '20';
const DECLARED_RETURN_QTY = '20';
const INVALID_VERIFIED_QTY = '21';
const VERIFIED_RETURN_QTY = '15';

interface TicketFixture {
	ticketId: string;
	ticketNo: string;
}

async function createSuppliesTicket(
	page: Page,
	item: SeededItem,
	requestedQty: string,
	createdBy: string
): Promise<TicketFixture> {
	await page.goto('/back-office/distribution');
	await expect(page.getByRole('heading', { name: 'ระบบเบิกจ่ายพัสดุและอาหาร' })).toBeVisible();
	await page.getByRole('button', { name: 'สร้างใบเบิกจ่าย' }).click();
	const createDialog = page.getByRole('dialog', { name: /สร้างใบเบิกจ่ายพัสดุและอาหาร/ });
	await createDialog.getByRole('radio', { name: /พัสดุและสิ่งของ/ }).click();
	await createDialog.getByLabel(/จุดหมายปลายทาง/).click();
	await page.getByRole('option', { name: /ระบุจุดหมายอื่น/ }).click();
	await createDialog.getByPlaceholder(/พิมพ์ชื่อจุดหมายปลายทางที่ต้องการ/).fill('จุดแจก E2E');
	await createDialog.getByRole('button', { name: /เพิ่มรายการ/ }).click();
	const picker = page.getByRole('dialog', { name: /เลือกรายการพัสดุ/ });
	await picker.getByLabel(/ค้นหาชื่อรายการ/).fill(item.name);
	await picker.getByLabel(/จำนวนที่ต้องการเบิก/).fill(requestedQty);
	await picker.getByRole('button', { name: 'เลือก' }).click();
	await createDialog.getByRole('button', { name: 'ยืนยันสร้างใบเบิกจ่าย' }).click();
	await expect(page.getByText(/สร้างใบเบิกจ่าย.*สำเร็จ/)).toBeVisible();

	let ticketId = '';
	await expect
		.poll(
			async () => {
				const tickets = await findShelterDocuments(
					(doc) =>
						doc.type === 'requisition_ticket' &&
						doc.created_by === createdBy &&
						doc.ticket_no !== undefined &&
						doc.items !== undefined
				);
				const matching = tickets.find((doc) => {
					const items = doc.items;
					return (
						Array.isArray(items) &&
						items.some(
							(entry) =>
								entry &&
								typeof entry === 'object' &&
								(entry as { item_id?: unknown }).item_id === item.itemId
						)
					);
				});
				ticketId = matching?._id ?? '';
				return ticketId;
			},
			{ message: `Created ticket for ${item.name} was not persisted` }
		)
		.toMatch(/^requisition_ticket:/);
	const ticket = await getShelterDocument(ticketId);
	if (!ticket || typeof ticket.ticket_no !== 'string') {
		throw new Error(`Created ticket ${ticketId} was not readable`);
	}
	return { ticketId, ticketNo: ticket.ticket_no };
}

async function expectTicketStatus(
	ticket: TicketFixture,
	status: string,
	checkpoint: string
): Promise<void> {
	await expect
		.poll(async () => (await getShelterDocument(ticket.ticketId))?.status, {
			message: `${checkpoint}: ${ticket.ticketNo} should be ${status}`
		})
		.toBe(status);
}

async function selectSuppliesTicket(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem
): Promise<void> {
	const selector = page.getByLabel('เลือกตั๋วพัสดุที่ใช้งาน');
	if ((await selector.count()) > 0) {
		await selector.click();
		await page.getByRole('option', { name: new RegExp(ticket.ticketNo) }).click();
		await expect(selector).toContainText(ticket.ticketNo);
	}
	await expect(page.getByRole('button', { name: new RegExp(item.name) })).toBeVisible();
}

async function selectReconciliationTicket(page: Page, ticket: TicketFixture): Promise<void> {
	const selector = page.getByLabel('เลือกตั๋วที่ต้องการปิดรอบหรือกระทบยอด');
	if ((await selector.count()) > 0) {
		await selector.click();
		await page.getByRole('option', { name: new RegExp(ticket.ticketNo) }).click();
		await expect(selector).toContainText(ticket.ticketNo);
	}
	await expect(
		page.getByRole('heading', { name: new RegExp(`ใบเบิก ${ticket.ticketNo}`) })
	).toBeVisible();
}

async function allocateTicket(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem,
	qty: string
): Promise<void> {
	await page.goto(`/back-office/distribution?ticketId=${encodeURIComponent(ticket.ticketId)}`);
	const before = await getShelterDocument(ticket.ticketId);
	if (!before?._rev)
		throw new Error(`Allocation checkpoint could not read revision for ${ticket.ticketNo}`);

	await page.getByRole('button', { name: 'จัดสรรยอดสินค้า' }).click();
	const allocation = page.getByRole('dialog', { name: /จัดสรรยอดสินค้า/ });
	await allocation.getByLabel(`ยอดจัดสรร ${item.name}`).fill(qty);

	await allocation.getByRole('button', { name: 'บันทึกการจัดสรร' }).click();
	await expect(allocation).toBeHidden();

	await expect
		.poll(async () => (await getShelterDocument(ticket.ticketId))?._rev, {
			message: `Allocation mutation did not persist for ${ticket.ticketNo}`
		})
		.not.toBe(before._rev);

	await expect
		.poll(
			async () => {
				const doc = await getShelterDocument(ticket.ticketId);
				const matchedItem = Array.isArray(doc?.items)
					? (doc?.items as Array<{ item_id?: string; allocated_qty?: string }>).find(
							(i) => i.item_id === item.itemId
						)
					: undefined;
				return matchedItem?.allocated_qty;
			},
			{ message: `Allocation did not set allocated_qty to ${qty} for ${ticket.ticketNo}` }
		)
		.toBe(qty);
}

async function approveTicket(page: Page, ticket: TicketFixture): Promise<void> {
	await page.getByRole('button', { name: 'อนุมัติให้ปล่อยของ' }).click();
	await page
		.getByRole('dialog', { name: /ยืนยันการอนุมัติปล่อยของ/ })
		.getByRole('button', { name: 'ยืนยันอนุมัติ' })
		.click();
	await expectTicketStatus(ticket, 'READY_FOR_DISPATCH', 'Approval checkpoint');
}

async function dispatchTicket(page: Page, ticket: TicketFixture, item: SeededItem): Promise<void> {
	await page.getByRole('button', { name: /เลือก Physical Lot และปล่อยรถ/ }).click();
	const dispatch = page.getByRole('dialog', { name: /เลือก Physical Lot และปล่อยรถ/ });
	await dispatch
		.getByRole('radiogroup', { name: `เลือก Physical Lot สินค้าสำหรับ ${item.name}` })
		.getByRole('radio')
		.click();
	await dispatch.getByRole('button', { name: /ยืนยันปล่อยรถ/ }).click();
	await expectTicketStatus(ticket, 'IN_TRANSIT', 'Dispatch checkpoint');
}

async function receiveAtFrontline(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem
): Promise<void> {
	await page.goto('/onsite/distribution');
	await page.getByRole('button', { name: /1\. รับของถึงจุดแจก/ }).click();
	const ticketCard = page
		.getByText(ticket.ticketNo, { exact: true })
		.locator('xpath=ancestor::div[contains(@class, "rounded-xl")][1]');
	await expect(ticketCard).toContainText(item.name);
	await ticketCard.getByRole('button', { name: /ตรวจรับเข้าจุดแจก/ }).click();
	await expectTicketStatus(ticket, 'DISTRIBUTING', 'Frontline receive checkpoint');
}

async function distributeToOutside(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem,
	qty: string
): Promise<void> {
	await page.getByRole('button', { name: /3\. จ่ายพัสดุ/ }).click();
	await selectSuppliesTicket(page, ticket, item);
	await page.getByRole('button', { name: new RegExp(item.name) }).click();
	await page.getByRole('button', { name: 'บุคคลภายนอก' }).click();
	await page.locator('#supplies-qty-input').fill(qty);
	await page.getByRole('button', { name: 'ยืนยันบันทึกแจกจ่ายพัสดุ' }).click();
	await expect(page.getByText(/บันทึกแจกจ่ายพัสดุสำเร็จ/)).toBeVisible();
	await expect
		.poll(
			async () =>
				(
					await findShelterDocuments(
						(doc) =>
							doc.type === 'distribution_log' &&
							doc.ticket_id === ticket.ticketId &&
							doc.item_id === item.itemId &&
							doc.qty === qty &&
							doc.recipient_type === 'outside'
					)
				).length,
			{ message: `Distribution checkpoint did not persist ${qty} for ${ticket.ticketNo}` }
		)
		.toBe(1);
}

async function closeShift(
	page: Page,
	ticket: TicketFixture,
	item: SeededItem,
	returnedQty: string
): Promise<void> {
	await page.getByRole('button', { name: /5\. ปิดรอบ/ }).click();
	await selectReconciliationTicket(page, ticket);
	await page.getByLabel(`จำนวนส่งคืน ${item.name}`).fill(returnedQty);
	await page.getByRole('button', { name: /ยืนยันปิดรอบแจกจ่าย/ }).click();
}

async function expectCompletedTicketInBrowser(page: Page, ticket: TicketFixture): Promise<void> {
	await page.goto(`/back-office/distribution?ticketId=${encodeURIComponent(ticket.ticketId)}`);
	const detail = page.getByRole('dialog', { name: ticket.ticketNo });
	await expect(detail).toBeVisible();
	const progress = detail.getByLabel('ขั้นตอนความคืบหน้าของตั๋วเบิกจ่าย');
	await expect(progress.getByText('เสร็จสมบูรณ์', { exact: true })).toBeVisible();
}

async function withScenario<T>(
	label: string,
	fn: (scenario: DistributionScenario) => Promise<T>
): Promise<T> {
	const scenario = await createDistributionScenario(label);
	let result!: T;
	let scenarioError: unknown;
	let cleanupError: unknown;

	try {
		result = await fn(scenario);
	} catch (error) {
		scenarioError = error;
	}

	try {
		await cleanupDistributionScenario(scenario);
	} catch (error) {
		cleanupError = error;
	}

	if (scenarioError && cleanupError) {
		throw new AggregateError([scenarioError, cleanupError], 'Scenario and cleanup both failed');
	}

	if (scenarioError) {
		throw scenarioError;
	}

	if (cleanupError) {
		throw cleanupError;
	}

	return result;
}

test.beforeEach(async ({ page }) => {
	await routeBrowserCouchThroughApp(page);
});

test.afterEach(async ({ page }) => {
	await clearSession(page);
	await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('Journey A: 100 allocated, 80 distributed, 0 returned completes without a warehouse receipt', async ({
	page
}) => {
	await withScenario('ticket_zero_return', async (scenario) => {
		let item!: SeededItem;
		let ticket!: TicketFixture;

		await test.step('Seed catalog stock and inject SM session', async () => {
			item = await seedItemWithStock(scenario, {
				name: `E2E consumable ${scenario.namespace}`,
				stockQty: ALLOCATED_QTY,
				returnable: false,
				typeClass: 'CONSUMABLE'
			});
			await injectSession(page, scenario.user, scenario.session);
		});

		await test.step('Create supplies ticket', async () => {
			ticket = await createSuppliesTicket(page, item, REQUESTED_QTY, scenario.user.name);
			await expectTicketStatus(ticket, 'PENDING_PICK', 'Create checkpoint');
		});

		await test.step('Allocate ticket items', async () => {
			await allocateTicket(page, ticket, item, ALLOCATED_QTY);
		});

		await test.step('Approve ticket', async () => {
			await approveTicket(page, ticket);
		});

		await test.step('Dispatch ticket with physical lot', async () => {
			await dispatchTicket(page, ticket, item);
		});

		await test.step('Receive ticket at frontline station', async () => {
			await receiveAtFrontline(page, ticket, item);
		});

		await test.step('Distribute to outside recipient', async () => {
			await distributeToOutside(page, ticket, item, DISTRIBUTED_QTY);
		});

		await test.step('Close shift with zero returns', async () => {
			await closeShift(page, ticket, item, ZERO_RETURN_QTY);
			await expectTicketStatus(ticket, 'COMPLETED', 'Zero-return close-shift checkpoint');
			await expect(page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ })).toHaveCount(0);
		});

		await test.step('Assert final ticket and warehouse receipt absence', async () => {
			const persistedTicket = await getShelterDocument(ticket.ticketId);
			expect(persistedTicket?.items).toMatchObject([
				{
					allocated_qty: ALLOCATED_QTY,
					distributed_qty: DISTRIBUTED_QTY,
					returned_qty: RETURNED_QTY,
					discrepancy_qty: DISCREPANCY_QTY
				}
			]);
			const warehouseReceipts = await findShelterDocuments(
				(doc) =>
					doc.type === 'stock_ledger' && doc.reason === 'receive' && doc.ref_id === ticket.ticketId
			);
			expect(warehouseReceipts).toHaveLength(0);
			await expectCompletedTicketInBrowser(page, ticket);
		});
	});
});

test('Journey B: warehouse credits only the lower verified return quantity', async ({ page }) => {
	await withScenario('ticket_physical_return', async (scenario) => {
		const item = await seedItemWithStock(scenario, {
			name: `E2E returnable stock ${scenario.namespace}`,
			stockQty: ALLOCATED_QTY,
			returnable: false,
			typeClass: 'CONSUMABLE'
		});
		await injectSession(page, scenario.user, scenario.session);

		const ticket = await createSuppliesTicket(page, item, REQUESTED_QTY, scenario.user.name);
		await expectTicketStatus(ticket, 'PENDING_PICK', 'Create checkpoint');
		await allocateTicket(page, ticket, item, ALLOCATED_QTY);
		await approveTicket(page, ticket);
		await dispatchTicket(page, ticket, item);
		await receiveAtFrontline(page, ticket, item);
		await distributeToOutside(page, ticket, item, DISTRIBUTED_QTY);
		await closeShift(page, ticket, item, DECLARED_RETURN_QTY);
		await expectTicketStatus(ticket, 'SHIFT_CLOSED', 'Declared-return close-shift checkpoint');

		const shiftClosed = await getShelterDocument(ticket.ticketId);
		expect(shiftClosed?.items).toMatchObject([{ returned_qty: DECLARED_RETURN_QTY }]);
		const reconciliationCard = page
			.getByRole('heading', { name: new RegExp(`ใบเบิก ${ticket.ticketNo}`) })
			.locator('xpath=ancestor::div[contains(@class, "rounded-2xl")][1]');
		await expect(reconciliationCard.getByText('ปิดรอบแจกแล้ว', { exact: true })).toBeVisible();
		await page.getByRole('button', { name: /ส่งคืนพัสดุกลับคลังกลาง/ }).click();
		await expectTicketStatus(ticket, 'RETURN_PENDING_RECEIPT', 'Submit-returns checkpoint');
		await expect(reconciliationCard.getByText('รอคลังตรวจรับคืน', { exact: true })).toBeVisible();

		await page.goto(`/back-office/distribution?ticketId=${encodeURIComponent(ticket.ticketId)}`);
		await page.getByRole('button', { name: /ตรวจรับของคืนเข้าคลังสินค้า/ }).click();
		const warehouse = page.getByRole('dialog', { name: /ตรวจรับของคืนเข้าคลังสินค้า/ });
		const verified = warehouse.getByLabel(`จำนวนตรวจรับจริง ${item.name}`);
		await verified.fill(INVALID_VERIFIED_QTY);
		await expect(
			warehouse.getByRole('button', { name: /ยืนยันตรวจรับเข้าสต็อกคลัง/ })
		).toBeDisabled();
		await verified.fill(VERIFIED_RETURN_QTY);
		await warehouse.getByRole('button', { name: /ยืนยันตรวจรับเข้าสต็อกคลัง/ }).click();
		await expectTicketStatus(ticket, 'RETURN_COMPLETED', 'Warehouse receipt checkpoint');
		await expect(page.getByText('ตรวจรับคืนเรียบร้อยแล้ว', { exact: true })).toBeVisible();

		const receipts = await findShelterDocuments(
			(doc) =>
				doc.type === 'stock_ledger' && doc.reason === 'receive' && doc.ref_id === ticket.ticketId
		);
		expect(receipts).toHaveLength(1);
		expect(receipts[0]?.qty).toBe(VERIFIED_RETURN_QTY);
		expect(receipts[0]?.qty).not.toBe(DECLARED_RETURN_QTY);

		await page.getByRole('button', { name: /ปิดตั๋วใบเบิกจ่าย/ }).click();
		const completeDialog = page.getByRole('dialog', {
			name: 'ยืนยันการปิดตั๋วใบเบิกจ่าย'
		});
		await expect(completeDialog).toBeVisible();
		await completeDialog.getByRole('button', { name: 'ยืนยันปิดตั๋ว' }).click();
		await expectTicketStatus(ticket, 'COMPLETED', 'Ticket-completion checkpoint');
		await expectCompletedTicketInBrowser(page, ticket);
	});
});
