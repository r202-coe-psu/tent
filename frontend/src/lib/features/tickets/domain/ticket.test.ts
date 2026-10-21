import { describe, it, expect } from 'vitest';
import {
	createTicket,
	allocateTicketItem,
	approveTicket,
	approveTicketWithAllocations,
	markTicketDispatched,
	receiveTicket,
	cancelTicket,
	resolveTicketItemUnit,
	isRequisitionTicket,
	type RequisitionTicket
} from './ticket';
import type { AuthorContext } from '$lib/db/model';
import type { ItemMaster } from '$lib/features/catalog';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'kitchen_staff' };
const warehouseCtx: AuthorContext = { shelterCode: 'SH001', createdBy: 'warehouse_staff' };
const managerCtx: AuthorContext = { shelterCode: 'SH001', createdBy: 'shelter_manager' };

function baseInput() {
	return {
		meal_plan_id: 'meal_plan:01J',
		items: [{ item_id: 'item_master:rice', item_name: 'ข้าวสาร', unit: 'kg', requested_qty: '30' }]
	};
}

describe('createTicket', () => {
	it('generates requisition_ticket:{ulid}, starts PENDING_PICK, allocated_qty 0', () => {
		const ticket = createTicket(baseInput(), 'TKT-KITCHEN-0001', ctx);
		expect(ticket._id).toMatch(/^requisition_ticket:[0-9A-Z]{26}$/);
		expect(ticket.type).toBe('requisition_ticket');
		expect(ticket.requisition_type).toBe('kitchen');
		expect(ticket.status).toBe('PENDING_PICK');
		expect(ticket.ticket_no).toBe('TKT-KITCHEN-0001');
		expect(ticket.meal_plan_id).toBe('meal_plan:01J');
		expect(ticket.requested_by).toBe('kitchen_staff');
		expect(ticket.items).toEqual([
			{
				item_id: 'item_master:rice',
				item_name: 'ข้าวสาร',
				unit: 'kg',
				requested_qty: '30',
				allocated_qty: '0'
			}
		]);
	});

	it('defaults source/destination location', () => {
		const ticket = createTicket(baseInput(), 'TKT-KITCHEN-0001', ctx);
		expect(ticket.source_location).toBe('warehouse:main');
		expect(ticket.destination_location).toBe('kitchen');
	});

	it('rejects an empty items array', () => {
		expect(() => createTicket({ ...baseInput(), items: [] }, 'TKT-KITCHEN-0001', ctx)).toThrow();
	});
});

describe('isRequisitionTicket', () => {
	it('narrows on type field', () => {
		const ticket = createTicket(baseInput(), 'TKT-KITCHEN-0001', ctx);
		expect(isRequisitionTicket(ticket)).toBe(true);
		expect(isRequisitionTicket({ type: 'meal_plan' })).toBe(false);
		expect(isRequisitionTicket(null)).toBe(false);
	});

	it('rejects non-kitchen requisition tickets (distribution lifecycle)', () => {
		const ticket = createTicket(baseInput(), 'TKT-KITCHEN-0001', ctx);
		expect(isRequisitionTicket({ ...ticket, requisition_type: 'supplies' })).toBe(false);
		expect(
			isRequisitionTicket({ ...ticket, requisition_type: 'supplies', status: 'DISTRIBUTING' })
		).toBe(false);
	});
});

describe('ticket lifecycle transitions', () => {
	function pendingTicket(): RequisitionTicket {
		return createTicket(baseInput(), 'TKT-KITCHEN-0001', ctx);
	}

	it('allocateTicketItem sets the picked qty while PENDING_PICK', () => {
		const allocated = allocateTicketItem(pendingTicket(), 'item_master:rice', '30');
		expect(allocated.items[0].allocated_qty).toBe('30');
		expect(allocated.status).toBe('PENDING_PICK');
	});

	it('allocateTicketItem rejects an unknown item_id', () => {
		expect(() => allocateTicketItem(pendingTicket(), 'item_master:missing', '5')).toThrow(
			/not found/
		);
	});

	it('allocateTicketItem rejects once no longer PENDING_PICK', () => {
		const ready = approveTicket(
			allocateTicketItem(pendingTicket(), 'item_master:rice', '30'),
			managerCtx
		);
		expect(() => allocateTicketItem(ready, 'item_master:rice', '10')).toThrow(
			/ticket is READY_FOR_DISPATCH/
		);
	});

	function twoLineTicket(): RequisitionTicket {
		return createTicket(
			{
				...baseInput(),
				items: [
					...baseInput().items,
					{ item_id: 'item_master:salt', item_name: 'เกลือ', unit: 'kg', requested_qty: '2' }
				]
			},
			'TKT-KITCHEN-0002',
			ctx
		);
	}

	it('approveTicket rejects when every line is allocated_qty 0 (at least one must be > 0)', () => {
		expect(() => approveTicket(pendingTicket(), managerCtx)).toThrow(
			/at least one item must have allocated_qty > 0/
		);
	});

	it('approveTicket allows some lines at 0 as long as one is > 0', () => {
		const partial = allocateTicketItem(twoLineTicket(), 'item_master:rice', '30');
		const approved = approveTicket(partial, managerCtx);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.items.map((i) => i.allocated_qty)).toEqual(['30', '0']);
	});

	it('approveTicket rejects an invalid (negative) allocated_qty', () => {
		const bad = {
			...allocateTicketItem(twoLineTicket(), 'item_master:rice', '30'),
			items: [
				{ ...twoLineTicket().items[0], allocated_qty: '30' },
				{ ...twoLineTicket().items[1], allocated_qty: '-1' }
			]
		};
		expect(() => approveTicket(bad, managerCtx)).toThrow(/invalid allocated_qty/);
	});

	it('approveTicketWithAllocations keeps an explicit 0 (does not fall back to requested)', () => {
		const approved = approveTicketWithAllocations(
			twoLineTicket(),
			{ 'item_master:rice': '10', 'item_master:salt': '0' },
			managerCtx
		);
		expect(approved.items.map((i) => i.allocated_qty)).toEqual(['10', '0']);
	});

	it('approveTicketWithAllocations applies allocations and approves in one doc', () => {
		const approved = approveTicketWithAllocations(
			pendingTicket(),
			{ 'item_master:rice': '25.5' },
			managerCtx
		);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.approved_by).toBe('shelter_manager');
		expect(approved.items[0].allocated_qty).toBe('25.5');
	});

	it('approveTicketWithAllocations falls back to requested_qty for lines not in the map', () => {
		const approved = approveTicketWithAllocations(pendingTicket(), {}, managerCtx);
		expect(approved.items[0].allocated_qty).toBe(approved.items[0].requested_qty);
	});

	it('approveTicketWithAllocations rejects all-zero, invalid, unknown item and non-PENDING_PICK', () => {
		expect(() =>
			approveTicketWithAllocations(pendingTicket(), { 'item_master:rice': '0' }, managerCtx)
		).toThrow(/at least one item must have allocated_qty > 0/);
		expect(() =>
			approveTicketWithAllocations(pendingTicket(), { 'item_master:rice': 'abc' }, managerCtx)
		).toThrow();
		expect(() =>
			approveTicketWithAllocations(pendingTicket(), { 'item_master:nope': '5' }, managerCtx)
		).toThrow(/not found/);
		const ready = approveTicketWithAllocations(pendingTicket(), {}, managerCtx);
		expect(() => approveTicketWithAllocations(ready, {}, managerCtx)).toThrow(/ticket is/);
	});

	it('approveTicket moves PENDING_PICK → READY_FOR_DISPATCH and stamps approved_by', () => {
		const allocated = allocateTicketItem(pendingTicket(), 'item_master:rice', '30');
		const approved = approveTicket(allocated, managerCtx);
		expect(approved.status).toBe('READY_FOR_DISPATCH');
		expect(approved.approved_by).toBe('shelter_manager');
	});

	it('markTicketDispatched moves READY_FOR_DISPATCH → IN_TRANSIT and stamps dispatched_by', () => {
		const approved = approveTicket(
			allocateTicketItem(pendingTicket(), 'item_master:rice', '30'),
			managerCtx
		);
		const dispatched = markTicketDispatched(approved, warehouseCtx);
		expect(dispatched.status).toBe('IN_TRANSIT');
		expect(dispatched.dispatched_by).toBe('warehouse_staff');
	});

	it('markTicketDispatched rejects from any status other than READY_FOR_DISPATCH', () => {
		expect(() => markTicketDispatched(pendingTicket(), warehouseCtx)).toThrow(
			/ticket is PENDING_PICK/
		);
	});

	it('receiveTicket moves IN_TRANSIT → COMPLETED and stamps received_by', () => {
		const approved = approveTicket(
			allocateTicketItem(pendingTicket(), 'item_master:rice', '30'),
			managerCtx
		);
		const dispatched = markTicketDispatched(approved, warehouseCtx);
		const received = receiveTicket(dispatched, ctx);
		expect(received.status).toBe('COMPLETED');
		expect(received.received_by).toBe('kitchen_staff');
	});

	it('receiveTicket rejects a double-receive', () => {
		const approved = approveTicket(
			allocateTicketItem(pendingTicket(), 'item_master:rice', '30'),
			managerCtx
		);
		const received = receiveTicket(markTicketDispatched(approved, warehouseCtx), ctx);
		expect(() => receiveTicket(received, ctx)).toThrow(/ticket is COMPLETED/);
	});

	it('cancelTicket cancels a PENDING_PICK or READY_FOR_DISPATCH ticket, records a reason', () => {
		const cancelled = cancelTicket(pendingTicket(), 'เปลี่ยนแผนเมนู');
		expect(cancelled.status).toBe('CANCELLED');
		expect(cancelled.notes).toBe('เปลี่ยนแผนเมนู');
	});

	it('cancelTicket rejects a ticket already IN_TRANSIT or COMPLETED', () => {
		const approved = approveTicket(
			allocateTicketItem(pendingTicket(), 'item_master:rice', '30'),
			managerCtx
		);
		const dispatched = markTicketDispatched(approved, warehouseCtx);
		expect(() => cancelTicket(dispatched)).toThrow(/ticket is IN_TRANSIT/);
	});
});

describe('resolveTicketItemUnit', () => {
	const rice: Pick<ItemMaster, 'base_unit' | 'conversions'> = {
		base_unit: 'kg',
		conversions: [{ uom_name: 'กระสอบ', multiplier: '50' }]
	};

	it('passes qty through unchanged when the requested unit already matches base_unit', () => {
		expect(resolveTicketItemUnit(rice, 'kg', '30')).toEqual({ unit: 'kg', qty: '30' });
	});

	it('is case/whitespace-insensitive on the base_unit match', () => {
		expect(resolveTicketItemUnit(rice, ' KG ', '30')).toEqual({ unit: 'kg', qty: '30' });
	});

	it('converts via a matching conversions[] row (1 กระสอบ = 50 kg)', () => {
		expect(resolveTicketItemUnit(rice, 'กระสอบ', '2')).toEqual({ unit: 'kg', qty: '100' });
	});

	it('throws when no conversion matches the requested unit', () => {
		expect(() => resolveTicketItemUnit(rice, 'ถัง', '1')).toThrow(/no conversion/);
	});
});
