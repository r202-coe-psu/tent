import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	assertFlow2RequisitionTicket,
	assertRequisitionTicketMutation,
	assertRequisitionTicketTransition,
	canTransitionRequisitionTicket,
	createFlow2RequisitionTicket,
	flow2RequisitionTypeSchema,
	isFlow2RequisitionTicket,
	requisitionTicketDocSchema,
	requisitionTicketInputSchema
} from './requisition-ticket';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:flow2' };
const ULID = '01J00000000000000000000000';
const TICKET_ID = `requisition_ticket:${ULID}`;

const ticketItem = {
	item_id: 'item:rice',
	item_name: 'Rice',
	type_class: 'CONSUMABLE' as const,
	requested_qty: '10',
	allocated_qty: '10'
};

function ticketInput(requisition_type: 'food' | 'supplies' = 'food') {
	return {
		ticket_no: requisition_type === 'food' ? 'TKT-FOOD-0001' : 'TKT-SUPPLIES-0001',
		requisition_type,
		...(requisition_type === 'food' ? { meal: 'lunch' as const } : {}),
		source_location: 'warehouse:main',
		destination_location: 'distribution_point:zone-a',
		items: [ticketItem]
	};
}

describe('Food & Supplies RequisitionTicket contract ', () => {
	it('creates canonical Food and Supplies Tickets with a pending-pick initial state', () => {
		const food = createFlow2RequisitionTicket(ticketInput('food'), ctx, ULID);
		const supplies = createFlow2RequisitionTicket(ticketInput('supplies'), ctx, ULID);

		expect(food).toMatchObject({
			_id: TICKET_ID,
			type: 'requisition_ticket',
			schema_v: 1,
			status: 'PENDING_PICK',
			requested_by: ctx.createdBy,
			requisition_type: 'food'
		});
		expect(supplies.requisition_type).toBe('supplies');
	});

	it('keeps shared parsing broad but rejects Kitchen and Transfer at the Flow 2 boundary', () => {
		const food = createFlow2RequisitionTicket(ticketInput(), ctx, ULID);
		const kitchen = requisitionTicketDocSchema.parse({
			...food,
			requisition_type: 'kitchen',
			ticket_no: 'TKT-KITCHEN-0001'
		});
		const transfer = requisitionTicketDocSchema.parse({
			...food,
			requisition_type: 'transfer',
			ticket_no: 'TKT-TRANSFER-0001'
		});

		expect(isFlow2RequisitionTicket(kitchen)).toBe(false);
		expect(isFlow2RequisitionTicket(transfer)).toBe(false);
		expect(() => assertFlow2RequisitionTicket(kitchen)).toThrow(/not owned/);
		expect(() => flow2RequisitionTypeSchema.parse('kitchen')).toThrow();
	});

	it('validates ticket quantities, required item fields, and amendment identity', () => {
		expect(
			requisitionTicketInputSchema.safeParse({
				...ticketInput(),
				items: [{ ...ticketItem, requested_qty: '0' }]
			}).success
		).toBe(false);
		expect(
			requisitionTicketInputSchema.safeParse({
				...ticketInput(),
				items: [{ ...ticketItem, item_name: '' }]
			}).success
		).toBe(false);
		const ticket = createFlow2RequisitionTicket(ticketInput(), ctx, ULID);
		expect(
			requisitionTicketDocSchema.safeParse({
				...ticket,
				amendments: [
					{
						amendment_id: ULID,
						item_id: 'item:rice',
						added_qty: '1',
						amended_at: '2026-09-16T00:00:00.000Z',
						amended_by: 'staff:warehouse'
					}
				]
			}).success
		).toBe(true);
	});

	it('requires each ticket item_id to be unique', () => {
		const duplicateItems = [ticketItem, { ...ticketItem, item_name: 'Rice duplicate' }];
		expect(
			requisitionTicketInputSchema.safeParse({ ...ticketInput(), items: duplicateItems }).success
		).toBe(false);

		const ticket = createFlow2RequisitionTicket(ticketInput(), ctx, ULID);
		expect(
			requisitionTicketDocSchema.safeParse({
				...ticket,
				items: [ticket.items[0], { ...ticket.items[0], item_name: 'Rice duplicate' }]
			}).success
		).toBe(false);
	});

	it('requires the canonical Flow 2 ticket number and Food meal while leaving Supplies meal-free', () => {
		expect(requisitionTicketInputSchema.safeParse(ticketInput('food')).success).toBe(true);
		expect(
			requisitionTicketInputSchema.safeParse({ ...ticketInput('food'), ticket_no: 'TKT-FOOD-X' })
				.success
		).toBe(false);
		expect(
			requisitionTicketInputSchema.safeParse({
				...ticketInput('food'),
				ticket_no: 'TKT-SUPPLIES-0001'
			}).success
		).toBe(false);
		expect(
			requisitionTicketInputSchema.safeParse({ ...ticketInput('food'), meal: undefined }).success
		).toBe(false);
		expect(requisitionTicketInputSchema.safeParse(ticketInput('supplies')).success).toBe(true);
	});

	it('rejects numeric quantities in persisted Ticket documents while retaining explicit input coercion', () => {
		const ticket = createFlow2RequisitionTicket(ticketInput(), ctx, ULID);
		expect(
			requisitionTicketDocSchema.safeParse({
				...ticket,
				items: [{ ...ticket.items[0], requested_qty: 1 }]
			}).success
		).toBe(false);
		expect(
			requisitionTicketInputSchema.safeParse({
				...ticketInput(),
				items: [{ ...ticketItem, requested_qty: 1 }]
			}).success
		).toBe(true);
	});

	it('allows only canonical Ticket transitions and prevents post-dispatch cancellation', () => {
		expect(canTransitionRequisitionTicket('PENDING_PICK', 'READY_FOR_DISPATCH', 'food')).toBe(true);
		expect(canTransitionRequisitionTicket('READY_FOR_DISPATCH', 'IN_TRANSIT', 'supplies')).toBe(
			true
		);
		expect(canTransitionRequisitionTicket('IN_TRANSIT', 'DISTRIBUTING', 'food')).toBe(true);
		expect(canTransitionRequisitionTicket('IN_TRANSIT', 'COMPLETED', 'transfer')).toBe(true);
		expect(canTransitionRequisitionTicket('IN_TRANSIT', 'COMPLETED')).toBe(false);
		expect(canTransitionRequisitionTicket('IN_TRANSIT', 'COMPLETED', 'food')).toBe(false);
		expect(
			canTransitionRequisitionTicket('SHIFT_CLOSED', 'RETURN_PENDING_RECEIPT', 'supplies')
		).toBe(true);
		expect(canTransitionRequisitionTicket('RETURN_COMPLETED', 'COMPLETED', 'supplies')).toBe(true);
		expect(canTransitionRequisitionTicket('DISTRIBUTING', 'READY_FOR_DISPATCH', 'food')).toBe(
			false
		);
		expect(canTransitionRequisitionTicket('IN_TRANSIT', 'CANCELLED', 'food')).toBe(false);
		expect(canTransitionRequisitionTicket('COMPLETED', 'CANCELLED', 'food')).toBe(false);

		const ticket = createFlow2RequisitionTicket(ticketInput(), ctx, ULID);
		expect(() => assertRequisitionTicketTransition(ticket, 'DISTRIBUTING')).toThrow();
	});

	it('protects canonical immutable Ticket fields and the requested quantity floor after distributing', () => {
		const previous = requisitionTicketDocSchema.parse({
			...createFlow2RequisitionTicket(ticketInput(), ctx, ULID),
			status: 'DISTRIBUTING'
		});
		expect(() =>
			assertRequisitionTicketMutation(previous, { ...previous, ticket_no: 'TKT-CHANGED' })
		).toThrow(/immutable/);
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				items: [{ ...previous.items[0], requested_qty: '9' }]
			})
		).toThrow(/cannot be decreased/);
	});

	it('requires appended amendments to match the Decimal allocation increase of their existing item', () => {
		const previous = requisitionTicketDocSchema.parse({
			...createFlow2RequisitionTicket(ticketInput(), ctx, ULID),
			status: 'DISTRIBUTING'
		});
		const amendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item:rice',
			added_qty: '0.1',
			amended_at: '2026-09-16T00:00:00.000Z',
			amended_by: 'staff:warehouse'
		};
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				items: [{ ...previous.items[0], allocated_qty: '10.1' }],
				amendments: [amendment]
			})
		).not.toThrow();
		expect(() =>
			assertRequisitionTicketMutation(previous, { ...previous, amendments: [amendment] })
		).toThrow(/allocated_qty increase/);
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				items: [{ ...previous.items[0], allocated_qty: '10.2' }],
				amendments: [amendment]
			})
		).toThrow(/allocated_qty increase/);
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				amendments: [{ ...amendment, item_id: 'item:missing' }]
			})
		).toThrow(/unknown item_id/);
	});
});
