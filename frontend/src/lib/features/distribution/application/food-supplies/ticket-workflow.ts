import type { AuthorContext } from '$lib/db/model';
import { qtyGt, parseQty } from '$lib/utils/qty';
import type {
	RequisitionTicket,
	RequisitionTicketInput,
	TicketItem
} from '../../domain/food-supplies';
import {
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import {
	assertCanAllocateTicket,
	assertCanApproveTicket,
	assertCanCancelTicket,
	assertCanCreateTicket,
	assertCanPerformFrontlineDistribution
} from './auth';
import { TicketStateError, WorkflowValidationError } from './errors';

export interface ItemAllocationInput {
	item_id: string;
	allocated_qty: string;
	lot_ref?: string;
}

function resolveTicketRepo(
	repo: RequisitionTicketRepository | undefined,
	ctx: AuthorContext
): RequisitionTicketRepository {
	return repo ?? new RequisitionTicketRemoteRepository(ctx.shelterCode);
}

/**
 * Creates a new Food or Supplies Requisition Ticket in PENDING_PICK status (Step 1).
 */
export async function createRequisitionTicket(
	input: RequisitionTicketInput,
	ctx: AuthorContext,
	repo?: RequisitionTicketRepository
): Promise<RequisitionTicket> {
	assertCanCreateTicket(ctx);

	if (input.requisition_type !== 'food' && input.requisition_type !== 'supplies') {
		throw new WorkflowValidationError(
			`Invalid requisition_type '${input.requisition_type}' for Food & Supplies workflow`
		);
	}

	if (input.requisition_type === 'food' && !input.meal) {
		throw new WorkflowValidationError('Food requisition tickets require meal period');
	}

	if (!input.items || input.items.length === 0) {
		throw new WorkflowValidationError('Requisition ticket requires at least one item');
	}

	const ticketRepo = resolveTicketRepo(repo, ctx);
	return ticketRepo.create(input, ctx);
}

/**
 * Records picked and allocated quantities for items on a ticket in PENDING_PICK (Step 1B).
 */
export async function allocateTicketItems(
	ticketId: string,
	allocations: ItemAllocationInput[],
	ctx: AuthorContext,
	repo?: RequisitionTicketRepository
): Promise<RequisitionTicket> {
	assertCanAllocateTicket(ctx);

	if (!allocations || allocations.length === 0) {
		throw new WorkflowValidationError('At least one item allocation is required');
	}

	for (const alloc of allocations) {
		const parsed = parseQty(alloc.allocated_qty);
		if (parsed.isNegative() || parsed.isZero()) {
			throw new WorkflowValidationError(
				`allocated_qty must be a positive decimal string for item ${alloc.item_id}`
			);
		}
	}

	const ticketRepo = resolveTicketRepo(repo, ctx);
	return ticketRepo.mutateTicketCAS(
		ticketId,
		(current) => {
			if (current.status !== 'PENDING_PICK') {
				throw new TicketStateError(
					`Cannot allocate items for ticket ${ticketId} in status '${current.status}'; expected PENDING_PICK`
				);
			}

			const allocMap = new Map(allocations.map((a) => [a.item_id, a]));
			const updatedItems: TicketItem[] = current.items.map((item) => {
				const alloc = allocMap.get(item.item_id);
				if (!alloc) return item;
				return {
					...item,
					allocated_qty: alloc.allocated_qty
				};
			});

			return {
				...current,
				items: updatedItems
			};
		},
		ctx
	);
}

/**
 * Manager approves picked ticket, transitioning PENDING_PICK -> READY_FOR_DISPATCH (Step 2).
 */
export async function approveTicketForDispatch(
	ticketId: string,
	ctx: AuthorContext,
	repo?: RequisitionTicketRepository
): Promise<RequisitionTicket> {
	assertCanApproveTicket(ctx);

	const ticketRepo = resolveTicketRepo(repo, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'PENDING_PICK') {
		throw new TicketStateError(
			`Cannot approve ticket ${ticketId} in status '${current.status}'; expected PENDING_PICK`
		);
	}

	for (const item of current.items) {
		if (!item.allocated_qty || !qtyGt(item.allocated_qty, 0)) {
			throw new WorkflowValidationError(
				`Item ${item.item_name} (${item.item_id}) must have positive allocated_qty before approval`
			);
		}
	}

	return ticketRepo.transitionTicket(ticketId, 'READY_FOR_DISPATCH', ctx, {
		approved_by: ctx.createdBy
	});
}

/**
 * Frontline staff receives physical goods at distribution point, transitioning IN_TRANSIT -> DISTRIBUTING (Step 4).
 */
export async function receiveTicketAtDistributionPoint(
	ticketId: string,
	ctx: AuthorContext,
	repo?: RequisitionTicketRepository
): Promise<RequisitionTicket> {
	assertCanPerformFrontlineDistribution(ctx);

	const ticketRepo = resolveTicketRepo(repo, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'IN_TRANSIT') {
		throw new TicketStateError(
			`Cannot receive ticket ${ticketId} at distribution point in status '${current.status}'; expected IN_TRANSIT`
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'DISTRIBUTING', ctx, { received_by: ctx.createdBy });
}

/**
 * Cancels a ticket if it is still prior to dispatch (PENDING_PICK or READY_FOR_DISPATCH).
 */
export async function cancelTicket(
	ticketId: string,
	reason: string,
	ctx: AuthorContext,
	repo?: RequisitionTicketRepository
): Promise<RequisitionTicket> {
	assertCanCancelTicket(ctx);

	const ticketRepo = resolveTicketRepo(repo, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'PENDING_PICK' && current.status !== 'READY_FOR_DISPATCH') {
		throw new TicketStateError(
			`Cannot cancel ticket ${ticketId} in status '${current.status}'; only pre-dispatch tickets may be cancelled`
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'CANCELLED', ctx, { notes: reason });
}
