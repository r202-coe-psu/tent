import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { addQty, parseQty, qtyGt, qtyNeg } from '$lib/utils/qty';
import {
	createStockLedger,
	type OperationsRepository,
	operationsRepository
} from '$lib/features/operations';
import type { RequisitionTicket, TicketAmendment } from '../../domain/food-supplies';
import {
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanDispatchTicket } from './auth';
import { TicketStateError, WorkflowValidationError } from './errors';

export interface DispatchWorkflowDependencies {
	ticketRepo?: RequisitionTicketRepository;
	operationsRepo?: OperationsRepository;
}

export interface DispatchTicketOptions {
	driver_name?: string;
	license_plate?: string;
	item_lots?: Record<string, string>;
}

export interface InFlightAmendmentInput {
	item_id: string;
	added_qty: string;
	reason?: string;
	lot_ref?: string;
}

function resolveDependencies(
	deps: DispatchWorkflowDependencies | undefined,
	ctx: AuthorContext
): { ticketRepo: RequisitionTicketRepository; operationsRepo: OperationsRepository } {
	return {
		ticketRepo: deps?.ticketRepo ?? new RequisitionTicketRemoteRepository(ctx.shelterCode),
		operationsRepo: deps?.operationsRepo ?? operationsRepository(ctx.shelterCode)
	};
}

/**
 * Dispatches a ticket, creating outbound stock ledger deductions and transitioning to IN_TRANSIT (Step 3).
 */
export async function dispatchTicket(
	ticketId: string,
	options: DispatchTicketOptions | undefined,
	ctx: AuthorContext,
	deps?: DispatchWorkflowDependencies
): Promise<{ ticket: RequisitionTicket; ledgerEntriesCreated: number }> {
	assertCanDispatchTicket(ctx);

	const { ticketRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'READY_FOR_DISPATCH') {
		throw new TicketStateError(
			`Cannot dispatch ticket ${ticketId} in status '${current.status}'; expected READY_FOR_DISPATCH`
		);
	}

	for (const item of current.items) {
		if (!item.allocated_qty || !qtyGt(item.allocated_qty, 0)) {
			throw new WorkflowValidationError(
				`Item ${item.item_name} (${item.item_id}) has no valid allocated quantity to dispatch`
			);
		}
	}

	// Retrieve existing ledger rows for this ticket to guarantee idempotent retry
	const existingLedger = await operationsRepo.listLedger();
	const existingTicketEntries = existingLedger.filter(
		(entry) => entry.ref_id === current._id && entry.reason === 'distribute'
	);
	const existingItemIds = new Set(existingTicketEntries.map((e) => e.item_id));

	let createdCount = 0;
	for (const item of current.items) {
		if (existingItemIds.has(item.item_id)) {
			// Already deducted on an earlier retry attempt
			continue;
		}

		const lotRef =
			options?.item_lots?.[item.item_id] &&
			options.item_lots[item.item_id].startsWith('stock_ledger:')
				? options.item_lots[item.item_id]
				: `stock_ledger:${ulid()}`;

		const ledgerEntry = createStockLedger(
			{
				item_id: item.item_id,
				qty: qtyNeg(item.allocated_qty),
				unit: 'ชิ้น',
				reason: 'distribute',
				ref_id: current._id,
				lot_ref: lotRef,
				occurred_at: now()
			},
			ctx
		);

		await operationsRepo.addLedgerEntry(ledgerEntry);
		createdCount++;
	}

	const updatedTicket = await ticketRepo.transitionTicket(ticketId, 'IN_TRANSIT', ctx, {
		dispatched_by: ctx.createdBy,
		...(options?.driver_name ? { driver_name: options.driver_name } : {}),
		...(options?.license_plate ? { license_plate: options.license_plate } : {})
	});

	return {
		ticket: updatedTicket,
		ledgerEntriesCreated: createdCount
	};
}

/**
 * Top-up amendment for an active ticket during frontline distribution (In-flight Amendment).
 */
export async function amendActiveTicket(
	ticketId: string,
	input: InFlightAmendmentInput,
	ctx: AuthorContext,
	deps?: DispatchWorkflowDependencies
): Promise<RequisitionTicket> {
	assertCanDispatchTicket(ctx);

	const addedDec = parseQty(input.added_qty);
	if (addedDec.isNegative() || addedDec.isZero()) {
		throw new WorkflowValidationError('Amendment added_qty must be a positive decimal string');
	}

	const { ticketRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'DISTRIBUTING') {
		throw new TicketStateError(
			`Cannot amend ticket ${ticketId} in status '${current.status}'; expected DISTRIBUTING`
		);
	}

	const targetItem = current.items.find((i) => i.item_id === input.item_id);
	if (!targetItem) {
		throw new WorkflowValidationError(`Item ${input.item_id} does not exist on ticket ${ticketId}`);
	}

	const lotRef =
		input.lot_ref && input.lot_ref.startsWith('stock_ledger:')
			? input.lot_ref
			: `stock_ledger:${ulid()}`;

	// Write outbound deduction for top-up
	const ledgerEntry = createStockLedger(
		{
			item_id: input.item_id,
			qty: qtyNeg(input.added_qty),
			unit: 'ชิ้น',
			reason: 'distribute',
			ref_id: current._id,
			lot_ref: lotRef,
			occurred_at: now()
		},
		ctx
	);
	await operationsRepo.addLedgerEntry(ledgerEntry);

	// Update ticket with amendment
	return ticketRepo.mutateTicketCAS(
		ticketId,
		(ticket) => {
			const amendment: TicketAmendment = {
				amendment_id: ulid(),
				item_id: input.item_id,
				added_qty: input.added_qty,
				amended_at: now(),
				amended_by: ctx.createdBy,
				reason: input.reason || 'Frontline radio top-up request'
			};

			const updatedItems = ticket.items.map((i) => {
				if (i.item_id !== input.item_id) return i;
				return {
					...i,
					allocated_qty: addQty(i.allocated_qty || '0', input.added_qty)
				};
			});

			return {
				...ticket,
				items: updatedItems,
				amendments: [...(ticket.amendments || []), amendment]
			};
		},
		ctx
	);
}
