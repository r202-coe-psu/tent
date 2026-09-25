import { z } from 'zod';
import type { BaseDoc, AuthorContext } from '$lib/db/model';
import { makeDoc, touch } from '$lib/db/model';
import {
	persistQty,
	parseQty,
	qtyGt,
	qtyStrCoercePositiveSchema,
	qtyStrCoerceNonNegativeSchema
} from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';

// ---- RequisitionTicket (schema.md §2.29, CR-121 + kitchen carve-out CR-139) ----
// Scope: `requisition_type: 'kitchen'` only. `food`/`supplies`/`transfer` are not
// implemented by this feature yet — see CR-139 for why the status enum here is a
// subset of CR-121's full 9-status lifecycle.

export const requisitionTypeSchema = z.literal('kitchen');
export type RequisitionType = z.infer<typeof requisitionTypeSchema>;

export const ticketStatusSchema = z.enum([
	'PENDING_PICK',
	'READY_FOR_DISPATCH',
	'IN_TRANSIT',
	'COMPLETED',
	'CANCELLED'
]);
export type TicketStatus = z.infer<typeof ticketStatusSchema>;

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
	PENDING_PICK: 'รอจัดของ',
	READY_FOR_DISPATCH: 'พร้อมจัดส่ง',
	IN_TRANSIT: 'กำลังจัดส่ง',
	COMPLETED: 'เสร็จสิ้น',
	CANCELLED: 'ยกเลิก'
};

export interface TicketItem {
	item_id: string; // item_master._id
	item_name: string;
	unit: string; // item_master.base_unit
	requested_qty: string; // qty_str > 0
	allocated_qty: string; // qty_str >= 0 — '0' until warehouse picks (CR-139)
}

export interface TicketGasDrawdown {
	cylinder_id: string; // fuel_cylinder._id
	qty_kg: string; // qty_str > 0
}

export interface RequisitionTicket extends BaseDoc {
	type: 'requisition_ticket';
	schema_v: 1;
	ticket_no: string;
	requisition_type: RequisitionType;
	status: TicketStatus;
	meal_plan_id: string; // kitchen-only idempotency/link key (CR-139)
	source_location: string;
	destination_location: string;
	requested_by: string;
	approved_by?: string;
	dispatched_by?: string;
	received_by?: string;
	items: TicketItem[];
	gas_drawdown?: TicketGasDrawdown[];
	notes?: string;
}

// ---- create ----

export const ticketItemInputSchema = z.object({
	item_id: z.string().min(1),
	item_name: z.string().trim().min(1),
	unit: z.string().trim().min(1),
	requested_qty: qtyStrCoercePositiveSchema
});
export type TicketItemInput = z.input<typeof ticketItemInputSchema>;

export const ticketGasDrawdownInputSchema = z.object({
	cylinder_id: z.string().min(1),
	qty_kg: qtyStrCoercePositiveSchema
});
export type TicketGasDrawdownInput = z.input<typeof ticketGasDrawdownInputSchema>;

export const createTicketInputSchema = z.object({
	meal_plan_id: z.string().min(1),
	source_location: z.string().trim().min(1).default('warehouse:main'),
	destination_location: z.string().trim().min(1).default('kitchen'),
	items: z.array(ticketItemInputSchema).min(1, 'At least one item required'),
	gas_drawdown: z.array(ticketGasDrawdownInputSchema).optional()
});
export type CreateTicketInput = z.input<typeof createTicketInputSchema>;

export function createTicket(
	input: CreateTicketInput,
	ticketNo: string,
	ctx: AuthorContext
): RequisitionTicket {
	const d = createTicketInputSchema.parse(input);
	return makeDoc(
		'requisition_ticket',
		1,
		{
			ticket_no: ticketNo,
			requisition_type: 'kitchen' as const,
			status: 'PENDING_PICK' as const,
			meal_plan_id: d.meal_plan_id,
			source_location: d.source_location,
			destination_location: d.destination_location,
			requested_by: ctx.createdBy,
			items: d.items.map((i) => ({
				item_id: i.item_id,
				item_name: i.item_name,
				unit: i.unit,
				requested_qty: persistQty(i.requested_qty),
				allocated_qty: '0'
			})),
			...(d.gas_drawdown
				? {
						gas_drawdown: d.gas_drawdown.map((g) => ({
							cylinder_id: g.cylinder_id,
							qty_kg: persistQty(g.qty_kg)
						}))
					}
				: {})
		},
		ctx
	) as RequisitionTicket;
}

export const isRequisitionTicket = (d: unknown): d is RequisitionTicket =>
	!!d && typeof d === 'object' && (d as { type?: unknown }).type === 'requisition_ticket';

// ---- transitions (pure — no I/O, no ledger writes; see tickets/data for that) ----

/** Warehouse sets the picked quantity for one line while the ticket is PENDING_PICK. */
export function allocateTicketItem(
	ticket: RequisitionTicket,
	itemId: string,
	allocatedQty: string
): RequisitionTicket {
	if (ticket.status !== 'PENDING_PICK') {
		throw new Error(`allocateTicketItem: cannot allocate — ticket is ${ticket.status}`);
	}
	if (!ticket.items.some((i) => i.item_id === itemId)) {
		throw new Error(`allocateTicketItem: item "${itemId}" not found on ticket`);
	}
	const qty = persistQty(qtyStrCoerceNonNegativeSchema.parse(allocatedQty));
	const items = ticket.items.map((i) => (i.item_id === itemId ? { ...i, allocated_qty: qty } : i));
	return { ...touch(ticket), items };
}

/**
 * Kitchen edits its own requested items (qty, add/remove) while the ticket
 * hasn't been touched by the warehouse yet (CR-140). Not self-approve/bypass —
 * never writes `status`/`approved_by`/`allocated_qty`; existing lines keep
 * whatever `allocated_qty` they already had (still '0' at this point in
 * practice), new lines start at '0' same as `createTicket`.
 */
export function updateTicketRequestedItems(
	ticket: RequisitionTicket,
	items: TicketItemInput[]
): RequisitionTicket {
	if (ticket.status !== 'PENDING_PICK') {
		throw new Error(`updateTicketRequestedItems: cannot edit — ticket is ${ticket.status}`);
	}
	const parsed = z.array(ticketItemInputSchema).min(1, 'At least one item required').parse(items);
	const nextItems = parsed.map((i) => {
		const existing = ticket.items.find((existingItem) => existingItem.item_id === i.item_id);
		return {
			item_id: i.item_id,
			item_name: i.item_name,
			unit: i.unit,
			requested_qty: persistQty(i.requested_qty),
			allocated_qty: existing?.allocated_qty ?? '0'
		};
	});
	return { ...touch(ticket), items: nextItems };
}

/**
 * One-click approve (CR-141 — supersedes CR-139 §2.2's 3-role split for
 * `requisition_type: 'kitchen'` only). Auto-allocates every line to its full
 * `requested_qty`, then jumps straight `PENDING_PICK` → `COMPLETED` — the
 * combined effect of `approveTicket` + `markTicketDispatched` + `receiveTicket`,
 * performed by one actor in one step. Stock-ledger deduction for the newly
 * allocated qty still happens at the data layer (mirrors `dispatchTicket`'s
 * balance check), not here — this function only shapes the doc.
 */
export function oneStepApproveTicket(
	ticket: RequisitionTicket,
	ctx: AuthorContext
): RequisitionTicket {
	if (ticket.status !== 'PENDING_PICK') {
		throw new Error(`oneStepApproveTicket: cannot approve — ticket is ${ticket.status}`);
	}
	const items = ticket.items.map((i) => ({ ...i, allocated_qty: i.requested_qty }));
	return {
		...touch(ticket),
		items,
		gas_drawdown: [],
		status: 'COMPLETED',
		approved_by: ctx.createdBy,
		dispatched_by: ctx.createdBy,
		received_by: ctx.createdBy
	};
}

/** shelter_manager/system_admin approves — PENDING_PICK → READY_FOR_DISPATCH (AC-TKT-03). */
export function approveTicket(ticket: RequisitionTicket, ctx: AuthorContext): RequisitionTicket {
	if (ticket.status !== 'PENDING_PICK') {
		throw new Error(`approveTicket: cannot approve — ticket is ${ticket.status}`);
	}
	if (ticket.items.some((i) => !qtyGt(i.allocated_qty, 0))) {
		throw new Error('approveTicket: every item must have allocated_qty > 0 before approval');
	}
	return { ...touch(ticket), status: 'READY_FOR_DISPATCH', approved_by: ctx.createdBy };
}

/** warehouse_staff releases the goods — READY_FOR_DISPATCH → IN_TRANSIT (FR-TKT-04). */
export function markTicketDispatched(
	ticket: RequisitionTicket,
	ctx: AuthorContext
): RequisitionTicket {
	if (ticket.status !== 'READY_FOR_DISPATCH') {
		throw new Error(`markTicketDispatched: cannot dispatch — ticket is ${ticket.status}`);
	}
	return { ...touch(ticket), status: 'IN_TRANSIT', dispatched_by: ctx.createdBy };
}

/** kitchen_staff confirms receipt — IN_TRANSIT → COMPLETED (CR-139 §2.1/§2.2). */
export function receiveTicket(ticket: RequisitionTicket, ctx: AuthorContext): RequisitionTicket {
	if (ticket.status !== 'IN_TRANSIT') {
		throw new Error(`receiveTicket: cannot receive — ticket is ${ticket.status}`);
	}
	return { ...touch(ticket), status: 'COMPLETED', received_by: ctx.createdBy };
}

/** Cancel before dispatch — any pre-IN_TRANSIT status → CANCELLED, terminal. */
export function cancelTicket(ticket: RequisitionTicket, reason?: string): RequisitionTicket {
	if (ticket.status !== 'PENDING_PICK' && ticket.status !== 'READY_FOR_DISPATCH') {
		throw new Error(`cancelTicket: cannot cancel — ticket is ${ticket.status}`);
	}
	return {
		...touch(ticket),
		status: 'CANCELLED',
		...(reason ? { notes: reason } : {})
	};
}

// ---- unit resolution (replaces meal-calc.ts's name-matching, see kitchen/domain/meal-calc.ts) ----

/**
 * Resolves a requested quantity/unit against an ItemMaster's base_unit via
 * `conversions[]` (1 `uom_name` = `multiplier` × `base_unit` — e.g. 1 "กระสอบ" = 50 kg).
 * Returns the quantity expressed in `base_unit`. Throws if the unit doesn't match
 * `base_unit` and no matching conversion row exists.
 */
export function resolveTicketItemUnit(
	itemMaster: Pick<ItemMaster, 'base_unit' | 'conversions'>,
	requestedUnit: string,
	requestedQty: string
): { unit: string; qty: string } {
	const unit = requestedUnit.trim();
	if (unit.toLowerCase() === itemMaster.base_unit.trim().toLowerCase()) {
		return { unit: itemMaster.base_unit, qty: persistQty(requestedQty) };
	}
	const conversion = itemMaster.conversions.find(
		(c) => c.uom_name.trim().toLowerCase() === unit.toLowerCase()
	);
	if (!conversion) {
		throw new Error(
			`resolveTicketItemUnit: no conversion from "${unit}" to base unit "${itemMaster.base_unit}"`
		);
	}
	return {
		unit: itemMaster.base_unit,
		qty: persistQty(parseQty(requestedQty).mul(conversion.multiplier))
	};
}
