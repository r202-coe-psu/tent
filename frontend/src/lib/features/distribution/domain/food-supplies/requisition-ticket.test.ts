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
	requisitionTicketInputSchema,
	ticketServiceDay
} from './requisition-ticket';
import { thailandCalendarDay } from './shared';

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
		...(requisition_type === 'food'
			? { meal: 'lunch' as const, service_date: thailandCalendarDay() }
			: {}),
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
			schema_v: 2,
			status: 'PENDING_PICK',
			requested_by: ctx.createdBy,
			requisition_type: 'food'
		});
		expect(supplies.requisition_type).toBe('supplies');
	});

	it('keeps shared parsing broad but rejects Kitchen and Transfer at the Flow 2 boundary', () => {
		// Supplies base: a food ticket's service_date may not ride along onto kitchen/transfer.
		const food = createFlow2RequisitionTicket(ticketInput('supplies'), ctx, ULID);
		const kitchen = requisitionTicketDocSchema.parse({
			...food,
			schema_v: 1,
			requisition_type: 'kitchen',
			ticket_no: 'TKT-KITCHEN-0001'
		});
		const transfer = requisitionTicketDocSchema.parse({
			...food,
			schema_v: 1,
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

	it('requires appended amendments to match the whole-unit allocation increase of their existing item', () => {
		const previous = requisitionTicketDocSchema.parse({
			...createFlow2RequisitionTicket(ticketInput(), ctx, ULID),
			status: 'DISTRIBUTING'
		});
		const amendment = {
			amendment_id: '01J00000000000000000000001',
			item_id: 'item:rice',
			added_qty: '1',
			amended_at: '2026-09-16T00:00:00.000Z',
			amended_by: 'staff:warehouse'
		};
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				items: [{ ...previous.items[0], allocated_qty: '11' }],
				amendments: [amendment]
			})
		).not.toThrow();
		expect(() =>
			assertRequisitionTicketMutation(previous, { ...previous, amendments: [amendment] })
		).toThrow(/allocated_qty increase/);
		expect(() =>
			assertRequisitionTicketMutation(previous, {
				...previous,
				items: [{ ...previous.items[0], allocated_qty: '12' }],
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

describe('service_date (draft-food-ticket-service-date)', () => {
	function addDays(day: string, delta: number): string {
		const d = new Date(`${day}T00:00:00.000Z`);
		d.setUTCDate(d.getUTCDate() + delta);
		return d.toISOString().slice(0, 10);
	}
	const today = thailandCalendarDay();

	it('stores the chosen day on a food ticket, including a later day', () => {
		const tomorrow = addDays(today, 1);
		const food = createFlow2RequisitionTicket(
			{ ...ticketInput('food'), service_date: tomorrow },
			ctx,
			ULID
		);
		expect(food.service_date).toBe(tomorrow);
		expect(ticketServiceDay(food)).toBe(tomorrow);
	});

	it('requires a valid service_date on a food ticket', () => {
		const withoutDay: Record<string, unknown> = { ...ticketInput('food') };
		delete withoutDay.service_date;
		expect(requisitionTicketInputSchema.safeParse(withoutDay).success).toBe(false);
		expect(
			requisitionTicketInputSchema.safeParse({ ...ticketInput('food'), service_date: '2026-02-30' })
				.success
		).toBe(false);
	});

	it('refuses a food ticket for a day already past', () => {
		expect(() =>
			createFlow2RequisitionTicket(
				{ ...ticketInput('food'), service_date: addDays(today, -1) },
				ctx,
				ULID
			)
		).toThrow(/past/);
	});

	it('keeps the service day fixed once the ticket exists', () => {
		const food = createFlow2RequisitionTicket(ticketInput('food'), ctx, ULID);
		expect(() =>
			assertRequisitionTicketMutation(food, { ...food, service_date: addDays(today, 1) })
		).toThrow(/service_date is immutable/);
	});

	it('keeps kitchen and transfer tickets on schema_v 1', () => {
		const supplies = createFlow2RequisitionTicket(ticketInput('supplies'), ctx, ULID);
		expect(
			requisitionTicketDocSchema.safeParse({
				...supplies,
				requisition_type: 'transfer',
				ticket_no: 'TKT-TRANSFER-0001'
			}).success
		).toBe(false);
	});

	it('keeps service_date off supplies tickets', () => {
		expect(
			requisitionTicketInputSchema.safeParse({ ...ticketInput('supplies'), service_date: today })
				.success
		).toBe(false);
		expect(createFlow2RequisitionTicket(ticketInput('supplies'), ctx, ULID).service_date).toBe(
			undefined
		);
	});

	it('still reads a schema_v 1 food ticket without service_date by its creation day', () => {
		const v1: Record<string, unknown> = {
			...createFlow2RequisitionTicket(ticketInput('food'), ctx, ULID)
		};
		delete v1.service_date;
		const legacy = requisitionTicketDocSchema.parse({
			...v1,
			schema_v: 1,
			created_at: '2026-10-06T18:00:00.000Z'
		});
		expect(ticketServiceDay(legacy)).toBe('2026-10-07');
		expect(requisitionTicketDocSchema.safeParse({ ...v1, schema_v: 2 }).success).toBe(false);
	});
});
