import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { formatDistributionTimestamp, calculateReturnStatus } from './item-distribution';
import { DistributionStore } from '../application/item-distribution-store.svelte';

describe('formatDistributionTimestamp', () => {
	it('formats date to Thai Buddhist short year and short month format', () => {
		// 2026-09-08 14:05 -> Buddhist year 2569 -> '69', September -> 'ก.ย.'
		const date = new Date(2026, 8, 8, 14, 5);
		const formatted = formatDistributionTimestamp(date);
		expect(formatted).toBe('8 ก.ย. 69 14:05');
	});

	it('pads single-digit hours and minutes with leading zeroes', () => {
		const date = new Date(2026, 0, 1, 9, 3);
		const formatted = formatDistributionTimestamp(date);
		expect(formatted).toBe('1 ม.ค. 69 09:03');
	});

	it('formats December correctly', () => {
		const date = new Date(2025, 11, 31, 23, 59);
		const formatted = formatDistributionTimestamp(date);
		expect(formatted).toBe('31 ธ.ค. 68 23:59');
	});

	it('returns a non-empty string when called without arguments', () => {
		const result = formatDistributionTimestamp();
		expect(typeof result).toBe('string');
		expect(result.length).toBeGreaterThan(0);
	});
});

describe('calculateReturnStatus', () => {
	it('returns "completed" when totalReturned + totalDamaged equals totalDistributed', () => {
		const status = calculateReturnStatus(8, 2, 10, 'distributing');
		expect(status).toBe('completed');
	});

	it('returns "completed" when totalReturned + totalDamaged exceeds totalDistributed', () => {
		const status = calculateReturnStatus(10, 1, 10, 'partially_returned');
		expect(status).toBe('completed');
	});

	it('returns "partially_returned" when only some items are returned', () => {
		const status = calculateReturnStatus(3, 0, 10, 'distributing');
		expect(status).toBe('partially_returned');
	});

	it('returns "partially_returned" when only damaged items are reported', () => {
		const status = calculateReturnStatus(0, 1, 10, 'distributing');
		expect(status).toBe('partially_returned');
	});

	it('preserves currentStatus when nothing has been returned or damaged', () => {
		const status = calculateReturnStatus(0, 0, 10, 'distributing');
		expect(status).toBe('distributing');
	});

	it('preserves currentStatus if totalDistributed is 0 even if return count is 0', () => {
		const status = calculateReturnStatus(0, 0, 0, 'pending_approval');
		expect(status).toBe('pending_approval');
	});
});

describe('DistributionStore', () => {
	let store: DistributionStore;

	beforeEach(() => {
		store = new DistributionStore();
	});

	afterEach(() => {
		store.destroy();
	});

	describe('returnBorrowedItem', () => {
		it('updates item returned/damaged quantities and recalculates status to partially_returned', () => {
			// Find a requisition with distributed items
			const ticket = store.requisitions.find((r) => r.total_distributed > 0);
			expect(ticket).toBeDefined();
			if (!ticket) return;

			const targetItem = ticket.items[0];
			const initialReturned = targetItem.returned_qty;
			const initialDamaged = targetItem.damaged_qty;

			store.returnBorrowedItem(ticket.ticket_code, targetItem.item_id, 1, 0);

			const updatedTicket = store.requisitions.find((r) => r.ticket_code === ticket.ticket_code)!;
			const updatedItem = updatedTicket.items.find((i) => i.item_id === targetItem.item_id)!;

			expect(updatedItem.returned_qty).toBe(initialReturned + 1);
			expect(updatedItem.damaged_qty).toBe(initialDamaged);
			expect(updatedTicket.total_returned).toBeGreaterThan(0);
		});

		it('marks requisition as completed when all distributed items are accounted for', () => {
			// Create a synthetic requisition ticket for isolated testing
			const testTicketCode = 'TKT-TEST-RETURN-ALL';
			store.requisitions = [
				{
					ticket_code: testTicketCode,
					hub_id: 'HUB-1',
					hub_name: 'ศูนย์พักพิงหลัก',
					target_group: 'evacuee',
					distribution_mode: 'borrow_return',
					items: [
						{
							item_id: 'ITEM-TEST-1',
							name: 'ผ้าห่มทดสอบ',
							quantity: 5,
							unit: 'ผืน',
							distributed_qty: 5,
							damaged_qty: 0,
							returned_qty: 0
						}
					],
					total_requested: 5,
					total_distributed: 5,
					total_damaged: 0,
					total_returned: 0,
					status: 'distributing',
					created_at: '1 ก.ย. 69 10:00',
					reason: 'ยืมใช้งานทดสอบ',
					requested_by: 'เจ้าหน้าที่ทดสอบ'
				},
				...store.requisitions
			];

			// Return 4 in good condition, 1 damaged = 5 total accounted
			store.returnBorrowedItem(testTicketCode, 'ITEM-TEST-1', 4, 1);

			const updatedTicket = store.requisitions.find((r) => r.ticket_code === testTicketCode)!;
			expect(updatedTicket.total_returned).toBe(4);
			expect(updatedTicket.total_damaged).toBe(1);
			expect(updatedTicket.status).toBe('completed');
		});

		it('gracefully handles non-existent ticket or item code', () => {
			expect(() => {
				store.returnBorrowedItem('NON-EXISTENT-TICKET', 'NON-EXISTENT-ITEM', 1, 0);
			}).not.toThrow();
		});
	});

	describe('distributeItemToRecipient', () => {
		it('deducts stock, adds distributed count, and logs the distribution', () => {
			const stockItem = store.readyStockItems[0];
			const initialAvailable = stockItem.availableQuantity;
			const initialDistributed = stockItem.distributedQuantity;
			const recipient = store.recipients[0];

			store.distributeItemToRecipient(stockItem.id, recipient.id, 2);

			const updatedStock = store.readyStockItems.find((s) => s.id === stockItem.id)!;
			expect(updatedStock.availableQuantity).toBe(initialAvailable - 2);
			expect(updatedStock.distributedQuantity).toBe(initialDistributed + 2);

			const latestLog = store.distributionLogs[0];
			expect(latestLog.item_name).toBe(stockItem.name);
			expect(latestLog.quantity).toBe(2);
			expect(latestLog.recipient_name).toBe(recipient.name);
		});

		it('clamps distributed quantity to available stock', () => {
			const stockItem = store.readyStockItems[0];
			const recipient = store.recipients[0];
			const excessQty = stockItem.availableQuantity + 500;

			store.distributeItemToRecipient(stockItem.id, recipient.id, excessQty);

			const updatedStock = store.readyStockItems.find((s) => s.id === stockItem.id)!;
			expect(updatedStock.availableQuantity).toBe(0);
		});

		it('throws when attempting to distribute while offline (CR-110)', () => {
			store.isOnline = false;
			const stockItem = store.readyStockItems[0];
			const recipient = store.recipients[0];

			expect(() => {
				store.distributeItemToRecipient(stockItem.id, recipient.id, 1);
			}).toThrow('ไม่สามารถบันทึกการแจกจ่ายได้ขณะออฟไลน์ (CR-110)');
		});
	});

	describe('createRequisition', () => {
		it('creates a new requisition and sets status to pending_approval', () => {
			const catalogItem = store.catalogItems[0];
			const initialCount = store.requisitions.length;

			const newTicket = store.createRequisition({
				hubId: 'HUB-TEST',
				hubName: 'จุดแจกจ่ายทดสอบ',
				targetGroup: 'evacuee',
				distributionMode: 'permanent',
				items: [{ catalogItemId: catalogItem.id, quantity: 10 }],
				reason: 'สำหรับครอบครัวผู้พักพิง'
			});

			expect(newTicket.status).toBe('pending_approval');
			expect(newTicket.total_requested).toBe(10);
			expect(newTicket.ticket_code).toMatch(/^TKT-DIST-\d{5}$/);
			expect(store.requisitions.length).toBe(initialCount + 1);
		});

		it('throws when attempting to create requisition while offline (CR-110)', () => {
			store.isOnline = false;
			const catalogItem = store.catalogItems[0];

			expect(() => {
				store.createRequisition({
					hubId: 'HUB-TEST',
					hubName: 'จุดแจกจ่ายทดสอบ',
					targetGroup: 'evacuee',
					distributionMode: 'permanent',
					items: [{ catalogItemId: catalogItem.id, quantity: 10 }],
					reason: 'สำหรับครอบครัวผู้พักพิง'
				});
			}).toThrow('ไม่สามารถสร้างคำร้องขอเบิกได้ขณะออฟไลน์ (CR-110)');
		});
	});
});
