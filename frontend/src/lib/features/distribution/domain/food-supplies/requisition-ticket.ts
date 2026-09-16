import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import {
	parseQty,
	qtyGt,
	qtyStrNonNegativeSchema,
	qtyStrPositiveSchema,
	qtyStrCoerceNonNegativeSchema,
	qtyStrCoercePositiveSchema
} from '$lib/utils/qty';
import {
	foodSuppliesBaseDocShape,
	mealPeriodSchema,
	type MealPeriod,
	requisitionTicketIdSchema,
	ULID_PATTERN
} from './shared';

/** Shared Ticket parser knows all canonical types; Flow 2 admits Food and Supplies only. */
export const requisitionTypeSchema = z.enum(['kitchen', 'food', 'supplies', 'transfer']);
export type RequisitionType = z.infer<typeof requisitionTypeSchema>;

export const flow2RequisitionTypeSchema = z.enum(['food', 'supplies']);
export type Flow2RequisitionType = z.infer<typeof flow2RequisitionTypeSchema>;

export const requisitionTicketStatusSchema = z.enum([
	'PENDING_PICK',
	'READY_FOR_DISPATCH',
	'IN_TRANSIT',
	'DISTRIBUTING',
	'SHIFT_CLOSED',
	'RETURN_PENDING_RECEIPT',
	'RETURN_COMPLETED',
	'COMPLETED',
	'CANCELLED'
]);
export type RequisitionTicketStatus = z.infer<typeof requisitionTicketStatusSchema>;

/** Strict persisted TicketItem contract. CR-038 forbids numeric JSON qty values in documents. */
export const ticketItemSchema = z.object({
	item_id: z.string().min(1),
	item_name: z.string().trim().min(1),
	category: z.string().trim().min(1).optional(),
	type_class: z.enum(['CONSUMABLE', 'DURABLE', 'EQUIPMENT']),
	returnable: z.boolean().optional(),
	requested_qty: qtyStrPositiveSchema,
	allocated_qty: qtyStrPositiveSchema,
	distributed_qty: qtyStrNonNegativeSchema.optional(),
	returned_qty: qtyStrNonNegativeSchema.optional(),
	discrepancy_qty: qtyStrNonNegativeSchema.optional()
});
export type TicketItem = z.infer<typeof ticketItemSchema>;

/** Explicit API/input boundary. Factories normalize quantities before persisting them. */
const ticketItemInputSchema = ticketItemSchema.extend({
	requested_qty: qtyStrCoercePositiveSchema,
	allocated_qty: qtyStrCoercePositiveSchema,
	distributed_qty: qtyStrCoerceNonNegativeSchema.optional(),
	returned_qty: qtyStrCoerceNonNegativeSchema.optional(),
	discrepancy_qty: qtyStrCoerceNonNegativeSchema.optional()
});

export const ticketAmendmentSchema = z.object({
	amendment_id: z.string().regex(new RegExp(`^${ULID_PATTERN}$`)),
	item_id: z.string().min(1),
	added_qty: qtyStrPositiveSchema,
	amended_at: z.string().datetime(),
	amended_by: z.string().min(1),
	reason: z.string().trim().min(1).optional()
});
export type TicketAmendment = z.infer<typeof ticketAmendmentSchema>;

export const requisitionTicketDocSchema = z
	.object({
		_id: requisitionTicketIdSchema,
		type: z.literal('requisition_ticket'),
		...foodSuppliesBaseDocShape,
		ticket_no: z.string().trim().min(1),
		requisition_type: requisitionTypeSchema,
		status: requisitionTicketStatusSchema,
		meal: mealPeriodSchema.optional(),
		source_location: z.string().trim().min(1),
		destination_location: z.string().trim().min(1),
		driver_name: z.string().trim().min(1).optional(),
		license_plate: z.string().trim().min(1).optional(),
		requested_by: z.string().min(1),
		approved_by: z.string().min(1).optional(),
		dispatched_by: z.string().min(1).optional(),
		received_by: z.string().min(1).optional(),
		items: z.array(ticketItemSchema).min(1),
		amendments: z.array(ticketAmendmentSchema).optional(),
		notes: z.string().trim().min(1).optional()
	})
	.superRefine((ticket, ctx) => {
		const amendmentIds = new Set<string>();
		for (const [index, amendment] of (ticket.amendments ?? []).entries()) {
			if (amendmentIds.has(amendment.amendment_id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['amendments', index, 'amendment_id'],
					message: 'Ticket amendment_id values must be unique'
				});
			}
			amendmentIds.add(amendment.amendment_id);
		}
	});
export type RequisitionTicket = BaseDoc & z.infer<typeof requisitionTicketDocSchema>;
export type Flow2RequisitionTicket = RequisitionTicket & {
	requisition_type: Flow2RequisitionType;
};

const flow2TicketNumberSchema = z.string().regex(/^TKT-(FOOD|SUPPLIES)-\d+$/);

export const requisitionTicketInputSchema = z
	.object({
		ticket_no: flow2TicketNumberSchema,
		requisition_type: flow2RequisitionTypeSchema,
		meal: mealPeriodSchema.optional(),
		source_location: z.string().trim().min(1),
		destination_location: z.string().trim().min(1),
		items: z.array(ticketItemInputSchema).min(1),
		notes: z.string().trim().min(1).optional()
	})
	.superRefine((ticket, ctx) => {
		const typeSegment = ticket.ticket_no.split('-')[1]?.toLowerCase();
		if (typeSegment !== ticket.requisition_type) {
			ctx.addIssue({
				code: 'custom',
				path: ['ticket_no'],
				message: 'ticket_no type segment must match requisition_type'
			});
		}
		if (ticket.requisition_type === 'food' && !ticket.meal) {
			ctx.addIssue({
				code: 'custom',
				path: ['meal'],
				message: 'Food requisition tickets require meal'
			});
		}
	});
export type RequisitionTicketInput = z.input<typeof requisitionTicketInputSchema>;

/** Creates only the Flow 2 Food/Supplies subset; shared parsing remains broader. */
export function createFlow2RequisitionTicket(
	input: RequisitionTicketInput,
	ctx: AuthorContext,
	id?: string
): Flow2RequisitionTicket {
	const parsed = requisitionTicketInputSchema.parse(input);
	return requisitionTicketDocSchema.parse(
		makeDoc(
			'requisition_ticket',
			1,
			{
				ticket_no: parsed.ticket_no,
				requisition_type: parsed.requisition_type,
				status: 'PENDING_PICK' as const,
				...(parsed.meal ? { meal: parsed.meal } : {}),
				source_location: parsed.source_location,
				destination_location: parsed.destination_location,
				requested_by: ctx.createdBy,
				items: parsed.items,
				...(parsed.notes ? { notes: parsed.notes } : {})
			},
			ctx,
			id
		)
	) as Flow2RequisitionTicket;
}

export function isFlow2RequisitionTicket(
	ticket: RequisitionTicket
): ticket is Flow2RequisitionTicket {
	return flow2RequisitionTypeSchema.safeParse(ticket.requisition_type).success;
}

export function assertFlow2RequisitionTicket(
	ticket: RequisitionTicket
): asserts ticket is Flow2RequisitionTicket {
	if (!isFlow2RequisitionTicket(ticket)) {
		throw new Error(`Requisition ticket ${ticket._id} is not owned by CR-059 Flow 2`);
	}
}

const TICKET_TRANSITIONS: Record<RequisitionTicketStatus, readonly RequisitionTicketStatus[]> = {
	PENDING_PICK: ['READY_FOR_DISPATCH', 'CANCELLED'],
	READY_FOR_DISPATCH: ['IN_TRANSIT', 'CANCELLED'],
	IN_TRANSIT: ['DISTRIBUTING', 'COMPLETED'],
	DISTRIBUTING: ['SHIFT_CLOSED'],
	SHIFT_CLOSED: ['RETURN_PENDING_RECEIPT', 'COMPLETED'],
	RETURN_PENDING_RECEIPT: ['RETURN_COMPLETED'],
	RETURN_COMPLETED: ['COMPLETED'],
	COMPLETED: [],
	CANCELLED: []
};

/** Generic graph check; `IN_TRANSIT → COMPLETED` is Transfer-only and needs type context. */
export function canTransitionRequisitionTicket(
	from: RequisitionTicketStatus,
	to: RequisitionTicketStatus,
	requisitionType?: RequisitionType
): boolean {
	if (!TICKET_TRANSITIONS[from].includes(to)) return false;
	if (from === 'IN_TRANSIT' && to === 'COMPLETED') {
		return requisitionType === 'transfer';
	}
	return true;
}

export function assertRequisitionTicketTransition(
	ticket: RequisitionTicket,
	to: RequisitionTicketStatus
): void {
	if (!canTransitionRequisitionTicket(ticket.status, to, ticket.requisition_type)) {
		throw new Error(`Illegal requisition_ticket transition: ${ticket.status} → ${to}`);
	}
}

const IMMUTABLE_TICKET_FIELDS = [
	'_id',
	'type',
	'schema_v',
	'ticket_no',
	'requisition_type',
	'created_at',
	'created_by'
] as const;

const POST_DISTRIBUTION_STATUSES = new Set<RequisitionTicketStatus>([
	'DISTRIBUTING',
	'SHIFT_CLOSED',
	'RETURN_PENDING_RECEIPT',
	'RETURN_COMPLETED',
	'COMPLETED'
]);

/** Domain-side immutable-field and requested-quantity floor guard. VDU enforces writes later. */
export function assertRequisitionTicketMutation(
	previous: RequisitionTicket,
	next: RequisitionTicket
): void {
	for (const field of IMMUTABLE_TICKET_FIELDS) {
		if (previous[field] !== next[field]) {
			throw new Error(`requisition_ticket.${field} is immutable`);
		}
	}
	if (POST_DISTRIBUTION_STATUSES.has(previous.status)) {
		const nextRequestedQty = new Map<string, string>();
		for (const item of next.items) {
			nextRequestedQty.set(item.item_id, item.requested_qty);
		}
		for (const item of previous.items) {
			const nextQty = nextRequestedQty.get(item.item_id);
			if (!nextQty || qtyGt(item.requested_qty, nextQty)) {
				throw new Error('requested_qty cannot be decreased or removed after DISTRIBUTING');
			}
		}
	}

	const previousAmendmentIds = new Set(
		(previous.amendments ?? []).map((item) => item.amendment_id)
	);
	const addedByItem = new Map<string, string>();
	for (const amendment of next.amendments ?? []) {
		if (previousAmendmentIds.has(amendment.amendment_id)) continue;
		if (!previous.items.some((item) => item.item_id === amendment.item_id)) {
			throw new Error(`Ticket amendment references unknown item_id ${amendment.item_id}`);
		}
		addedByItem.set(
			amendment.item_id,
			parseQty(addedByItem.get(amendment.item_id) ?? '0')
				.plus(amendment.added_qty)
				.toString()
		);
	}

	if (addedByItem.size > 0) {
		for (const previousItem of previous.items) {
			const nextItem = next.items.find((item) => item.item_id === previousItem.item_id);
			if (!nextItem) {
				throw new Error(`Ticket amendment item ${previousItem.item_id} must remain allocated`);
			}
			const allocationDelta = parseQty(nextItem.allocated_qty).minus(previousItem.allocated_qty);
			const amendmentQty = addedByItem.get(previousItem.item_id) ?? '0';
			if (!allocationDelta.eq(amendmentQty)) {
				throw new Error(
					`Ticket amendment quantity for ${previousItem.item_id} must equal its allocated_qty increase`
				);
			}
		}
	}
}

export { mealPeriodSchema, type MealPeriod };
