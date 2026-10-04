import { describe, expect, it } from 'vitest';
import type { RequisitionTicket, TicketItem } from '../../domain/food-supplies';
import type { AuthorContext } from '$lib/db/model';
import {
	buildVerifiedReturnsPayload,
	canShowCompleteTicketAction,
	canShowWarehouseReceiveAction,
	computeWarehouseItemPreview,
	computeWarehouseReturnSummary,
	initializeVerifiedQuantities,
	validateVerifiedQuantity,
	validateWarehouseReturnForm
} from './warehouse-return';

describe('Warehouse Return Verification & Ticket Completion UI Model', () => {
	const sampleItems: TicketItem[] = [
		{
			item_id: 'item:fan',
			item_name: 'พัดลม',
			type_class: 'EQUIPMENT',
			returnable: true,
			requested_qty: '10',
			allocated_qty: '10',
			distributed_qty: '7',
			returned_qty: '3',
			discrepancy_qty: '0'
		},
		{
			item_id: 'item:tent',
			item_name: 'เต็นท์นอน',
			type_class: 'EQUIPMENT',
			returnable: true,
			requested_qty: '100',
			allocated_qty: '100',
			distributed_qty: '80',
			returned_qty: '20',
			discrepancy_qty: '0'
		},
		{
			item_id: 'item:rice',
			item_name: 'ข้าวสาร',
			type_class: 'CONSUMABLE',
			returnable: false,
			requested_qty: '50',
			allocated_qty: '50',
			distributed_qty: '50',
			returned_qty: '0',
			discrepancy_qty: '0'
		}
	];

	const createMockContext = (
		capabilities: string[],
		shelterCode: string = 'SH001'
	): AuthorContext => {
		const roles: string[] = [];
		for (const cap of capabilities) {
			if (cap === 'system_admin' || cap === '_admin') {
				roles.push(cap);
			} else if (cap.startsWith('shelter:') || cap.includes(':')) {
				roles.push(cap);
			} else {
				if (!roles.includes(`shelter:${shelterCode}`)) {
					roles.push(`shelter:${shelterCode}`);
				}
				roles.push(`${shelterCode}:${cap}`);
				roles.push(cap);
			}
		}
		return {
			shelterCode,
			createdBy: 'user_test',
			roles
		};
	};

	const createTestTicket = (
		status: RequisitionTicket['status'],
		items: TicketItem[] = sampleItems
	): RequisitionTicket => {
		return {
			_id: 'requisition_ticket:tkt_test_01',
			type: 'requisition_ticket',
			schema_v: 1,
			shelter_code: 'SH001',
			created_at: '2026-09-24T10:00:00.000Z',
			updated_at: '2026-09-24T10:00:00.000Z',
			created_by: 'staff_test',
			ticket_no: 'TKT-FOOD-0001',
			requisition_type: 'supplies',
			status,
			source_location: 'คลังกลาง',
			destination_location: 'จุดแจก A',
			requested_by: 'staff_test',
			items
		};
	};

	describe('1. initialize verified qty from item.returned_qty', () => {
		it('initializes each verified qty from the frontline-declared returned_qty', () => {
			const initial = initializeVerifiedQuantities(sampleItems);
			expect(initial).toEqual({
				'item:fan': '3',
				'item:tent': '20',
				'item:rice': '0'
			});
		});

		it('defaults to 0 if item returned_qty is undefined', () => {
			const itemWithoutReturn: TicketItem = {
				item_id: 'item:water',
				item_name: 'น้ำดื่ม',
				type_class: 'CONSUMABLE',
				requested_qty: '20',
				allocated_qty: '20'
			};
			const initial = initializeVerifiedQuantities([itemWithoutReturn]);
			expect(initial).toEqual({
				'item:water': '0'
			});
		});
	});

	describe('2. zero accepted', () => {
		it('accepts zero as a valid verified returned quantity', () => {
			const res = validateVerifiedQuantity('0', '10');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('0');
		});
	});

	describe('3. exact frontend declared qty accepted', () => {
		it('accepts quantity exactly matching the frontline-declared returned qty', () => {
			const res = validateVerifiedQuantity('20', '20');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('20');
		});
	});

	describe('4. verified < declared accepted', () => {
		it('accepts verified quantity less than declared (e.g. 18 when declared 20)', () => {
			const res = validateVerifiedQuantity('18', '20');
			expect(res.isValid).toBe(true);
			expect(res.normalized).toBe('18');
		});
	});

	describe('5. verified > declared rejected', () => {
		it('rejects verified quantity exceeding declared quantity (warehouse cannot create stock out of thin air)', () => {
			const res = validateVerifiedQuantity('21', '20');
			expect(res.isValid).toBe(false);
			expect(res.error).toContain('ต้องไม่เกินจำนวนที่จุดแจกแจ้งส่งคืน');
		});
	});

	describe('6. negative rejected', () => {
		it('rejects negative quantity', () => {
			const res = validateVerifiedQuantity('-1', '20');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนตรวจรับต้องไม่ติดลบ (≥ 0)');
		});
	});

	describe('7. invalid decimal rejected', () => {
		it('rejects non-numeric string', () => {
			const res = validateVerifiedQuantity('abc', '20');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องเป็นตัวเลขจำนวนเต็มที่ถูกต้อง');
		});

		it('rejects empty or whitespace string', () => {
			const res = validateVerifiedQuantity('   ', '20');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('กรุณาระบุจำนวนตรวจรับ');
		});
	});

	describe('8. decimal notation rejected', () => {
		it('rejects decimal notation', () => {
			const res = validateVerifiedQuantity('18.5000', '20');
			expect(res.isValid).toBe(false);
			expect(res.error).toBe('จำนวนต้องเป็นจำนวนเต็ม เช่น 0, 1, 2, 3');
		});
	});

	describe('9. final discrepancy recalculated correctly', () => {
		it('allocated 100, distributed 80, frontline returned 20, verified 18 => discrepancy 2', () => {
			const tentItem: TicketItem = {
				item_id: 'item:tent',
				item_name: 'เต็นท์นอน',
				type_class: 'EQUIPMENT',
				requested_qty: '100',
				allocated_qty: '100',
				distributed_qty: '80',
				returned_qty: '20'
			};

			const preview = computeWarehouseItemPreview(tentItem, '18');
			expect(preview.allocated).toBe('100');
			expect(preview.distributed).toBe('80');
			expect(preview.frontlineReturned).toBe('20');
			expect(preview.verifiedReturned).toBe('18');
			expect(preview.discrepancy).toBe('2');
			expect(preview.hasDiscrepancy).toBe(true);
			expect(preview.isValid).toBe(true);
		});

		it('allocated 100, distributed 80, frontline returned 20, verified 20 => discrepancy 0', () => {
			const tentItem: TicketItem = {
				item_id: 'item:tent',
				item_name: 'เต็นท์นอน',
				type_class: 'EQUIPMENT',
				requested_qty: '100',
				allocated_qty: '100',
				distributed_qty: '80',
				returned_qty: '20'
			};

			const preview = computeWarehouseItemPreview(tentItem, '20');
			expect(preview.discrepancy).toBe('0');
			expect(preview.hasDiscrepancy).toBe(false);
		});

		it('summary preview aggregates totals and detects discrepancy across multiple items', () => {
			const formValues = {
				'item:fan': '3',
				'item:tent': '18', // 2 units missing
				'item:rice': '0'
			};
			const summary = computeWarehouseReturnSummary(sampleItems, formValues);
			expect(summary.totalAllocated).toBe('160');
			expect(summary.totalDistributed).toBe('137');
			expect(summary.totalFrontlineReturned).toBe('23');
			expect(summary.totalVerifiedReturned).toBe('21');
			expect(summary.totalDiscrepancy).toBe('2');
			expect(summary.hasDiscrepancy).toBe(true);
			expect(summary.isValid).toBe(true);
		});
	});

	describe('10. explicit verified_returned_quantities payload', () => {
		it('builds payload matching VerifiedWarehouseReturns structure', () => {
			const normalized = {
				'item:fan': '3',
				'item:tent': '18',
				'item:rice': '0'
			};
			const payload = buildVerifiedReturnsPayload(normalized);
			expect(payload).toEqual({
				verified_returned_quantities: {
					'item:fan': '3',
					'item:tent': '18',
					'item:rice': '0'
				}
			});
		});

		it('validates entire form and extracts clean normalizedValues', () => {
			const formValues = {
				'item:fan': '2',
				'item:tent': '18',
				'item:rice': '0'
			};
			const res = validateWarehouseReturnForm(sampleItems, formValues);
			expect(res.isValid).toBe(true);
			expect(res.normalizedValues).toEqual({
				'item:fan': '2',
				'item:tent': '18',
				'item:rice': '0'
			});
			expect(Object.keys(res.errors)).toHaveLength(0);
		});
	});

	describe('11. receive action visible for WH/SC/SM/SA', () => {
		const ticket = createTestTicket('RETURN_PENDING_RECEIPT');

		it('shows receive action for warehouse_staff (WH)', () => {
			const ctx = createMockContext(['warehouse_staff']);
			expect(canShowWarehouseReceiveAction(ticket, ctx)).toBe(true);
		});

		it('shows receive action for supply_coordinator (SC)', () => {
			const ctx = createMockContext(['supply_coordinator']);
			expect(canShowWarehouseReceiveAction(ticket, ctx)).toBe(true);
		});

		it('shows receive action for shelter_manager (SM)', () => {
			const ctx = createMockContext(['shelter_manager']);
			expect(canShowWarehouseReceiveAction(ticket, ctx)).toBe(true);
		});

		it('shows receive action for system_admin (SA)', () => {
			const ctx = createMockContext(['system_admin']);
			expect(canShowWarehouseReceiveAction(ticket, ctx)).toBe(true);
		});
	});

	describe('12. receive action hidden for REG', () => {
		const ticket = createTestTicket('RETURN_PENDING_RECEIPT');

		it('hides receive action for registration_staff (REG)', () => {
			const ctx = createMockContext(['registration_staff']);
			expect(canShowWarehouseReceiveAction(ticket, ctx)).toBe(false);
		});

		it('hides receive action if context is null', () => {
			expect(canShowWarehouseReceiveAction(ticket, null)).toBe(false);
		});

		it('hides receive action if ticket status is NOT RETURN_PENDING_RECEIPT', () => {
			const ctx = createMockContext(['warehouse_staff']);
			const shiftClosedTicket = createTestTicket('SHIFT_CLOSED');
			const distributingTicket = createTestTicket('DISTRIBUTING');
			expect(canShowWarehouseReceiveAction(shiftClosedTicket, ctx)).toBe(false);
			expect(canShowWarehouseReceiveAction(distributingTicket, ctx)).toBe(false);
		});
	});

	describe('13. complete action appears ONLY for RETURN_COMPLETED', () => {
		const ctx = createMockContext(['warehouse_staff']);

		it('shows complete action when status is RETURN_COMPLETED and actor is authorized', () => {
			const ticket = createTestTicket('RETURN_COMPLETED');
			expect(canShowCompleteTicketAction(ticket, ctx)).toBe(true);
		});

		it('hides complete action for SHIFT_CLOSED even though application workflow allows it for recovery', () => {
			const ticket = createTestTicket('SHIFT_CLOSED');
			expect(canShowCompleteTicketAction(ticket, ctx)).toBe(false);
		});

		it('hides complete action for RETURN_PENDING_RECEIPT', () => {
			const ticket = createTestTicket('RETURN_PENDING_RECEIPT');
			expect(canShowCompleteTicketAction(ticket, ctx)).toBe(false);
		});

		it('hides complete action for COMPLETED (already terminal)', () => {
			const ticket = createTestTicket('COMPLETED');
			expect(canShowCompleteTicketAction(ticket, ctx)).toBe(false);
		});

		it('hides complete action for unauthorized role (registration_staff)', () => {
			const regCtx = createMockContext(['registration_staff']);
			const ticket = createTestTicket('RETURN_COMPLETED');
			expect(canShowCompleteTicketAction(ticket, regCtx)).toBe(false);
		});
	});
});
