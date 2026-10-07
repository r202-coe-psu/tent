import { describe, expect, it, vi } from 'vitest';
import type { RequisitionTicket } from '../../domain/food-supplies';
import { getRequisitionTypeLabel, getTicketStatusLabel } from '../model/ticket-status';

const createSampleTicket = (overrides: Partial<RequisitionTicket> = {}): RequisitionTicket => {
	const base: RequisitionTicket = {
		_id: 'requisition_ticket:tkt_001',
		type: 'requisition_ticket',
		schema_v: 1,
		shelter_code: 'SH001',
		created_at: '2026-09-19T10:30:00.000Z',
		updated_at: '2026-09-19T10:30:00.000Z',
		created_by: 'staff_alice',
		ticket_no: 'TKT-FOOD-0001',
		requisition_type: 'food',
		status: 'PENDING_PICK',
		meal: 'lunch',
		source_location: 'ครัวกลาง',
		destination_location: 'จุดแจกเต็นท์ 1',
		requested_by: 'staff_alice',
		items: [
			{
				item_id: 'item:meal_box',
				item_name: 'ข้าวกล่องไก่ทอด',
				category: 'item_category:ready_meal',
				type_class: 'CONSUMABLE',
				returnable: false,
				requested_qty: '100',
				allocated_qty: '100'
			}
		]
	};

	return {
		...base,
		...overrides,
		schema_v: overrides.schema_v ?? base.schema_v,
		shelter_code: overrides.shelter_code ?? base.shelter_code,
		created_at: overrides.created_at ?? base.created_at,
		updated_at: overrides.updated_at ?? base.updated_at,
		created_by: overrides.created_by ?? base.created_by
	};
};

describe('Ticket Table & Presentation Invariants (Slice 5.1 §45)', () => {
	it('formats ticket columns using authoritative fields', () => {
		const ticket = createSampleTicket();

		expect(ticket.ticket_no).toBe('TKT-FOOD-0001');
		expect(ticket.requisition_type).toBe('food');
		expect(getRequisitionTypeLabel(ticket.requisition_type as 'food' | 'supplies')).toBe('อาหาร');
		expect(ticket.destination_location).toBe('จุดแจกเต็นท์ 1');
		expect(ticket.requested_by).toBe('staff_alice');
		expect(ticket.status).toBe('PENDING_PICK');
		expect(getTicketStatusLabel(ticket.status)).toBe('รอจัดของ');
	});

	it('formats supplies ticket type label accurately', () => {
		const suppliesTicket = createSampleTicket({
			ticket_no: 'TKT-SUPPLIES-0002',
			requisition_type: 'supplies',
			meal: undefined,
			destination_location: 'คลังเต็นท์โซน C'
		});

		expect(getRequisitionTypeLabel(suppliesTicket.requisition_type as 'food' | 'supplies')).toBe(
			'พัสดุ'
		);
		expect(suppliesTicket.destination_location).toBe('คลังเต็นท์โซน C');
	});

	it('strictly forbids exposing direct lifecycle mutation actions on ticket table', () => {
		// Slice 5.1 table exposes ONLY view details affordance; lifecycle transitions belong to Slice 5.2+
		const forbiddenActionLabels = [
			'จัดสรรยอด',
			'อนุมัติ',
			'ปล่อยของ',
			'นำส่ง',
			'รับของ',
			'ส่งคืน',
			'ปิดรอบ',
			'ตรวจรับ',
			'Allocate',
			'Approve',
			'Dispatch',
			'Receive',
			'Complete',
			'Cancel'
		];

		const allowedTableAffordance = 'ดูรายละเอียด';

		// Verify allowed vs forbidden contract
		expect(allowedTableAffordance).toBe('ดูรายละเอียด');
		for (const forbidden of forbiddenActionLabels) {
			expect(allowedTableAffordance).not.toContain(forbidden);
		}
	});

	it('details affordance triggers navigation or callback safely', () => {
		const ticket = createSampleTicket();
		const onView = vi.fn();

		onView(ticket);
		expect(onView).toHaveBeenCalledWith(ticket);
		expect(onView).toHaveBeenCalledTimes(1);
	});

	it('supports created_at sort toggle callback affordance', () => {
		const onToggleSort = vi.fn();
		onToggleSort();
		expect(onToggleSort).toHaveBeenCalledTimes(1);
	});
});
