import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { addQty, qtyGt, subQty } from '$lib/utils/qty';
import {
	createStockLedger,
	type OperationsRepository,
	operationsRepository
} from '$lib/features/operations';
import type { RequisitionTicket, TicketItem } from '../../domain/food-supplies';
import {
	DistributionLogRemoteRepository,
	type DistributionLogRepository,
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution, assertCanReceiveWarehouseReturns } from './auth';
import { TicketStateError } from './errors';

export interface ReconciliationDependencies {
	ticketRepo?: RequisitionTicketRepository;
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
}

export interface ItemReconciliationSummary {
	item_id: string;
	item_name: string;
	allocated_qty: string;
	distributed_qty: string;
	remaining_in_hand: string;
}

export interface ShiftCloseOptions {
	/** Optional explicit physical returned quantities if different from remaining in-hand */
	returned_quantities?: Record<string, string>;
}

export interface VerifiedWarehouseReturns {
	/** Actual verified quantities counted at warehouse dock */
	verified_returned_quantities?: Record<string, string>;
}

function resolveDependencies(
	deps: ReconciliationDependencies | undefined,
	ctx: AuthorContext
): {
	ticketRepo: RequisitionTicketRepository;
	logRepo: DistributionLogRepository;
	operationsRepo: OperationsRepository;
} {
	return {
		ticketRepo: deps?.ticketRepo ?? new RequisitionTicketRemoteRepository(ctx.shelterCode),
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode),
		operationsRepo: deps?.operationsRepo ?? operationsRepository(ctx.shelterCode)
	};
}

/**
 * Calculates current shift reconciliation dynamically from DistributionLog entries (AC-DST-02.2).
 */
export async function calculateShiftReconciliation(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<{
	ticket: RequisitionTicket;
	summaries: ItemReconciliationSummary[];
	hasLeftoverOrReturns: boolean;
}> {
	const { ticketRepo, logRepo } = resolveDependencies(deps, ctx);
	const ticket = await ticketRepo.get(ticketId);
	if (!ticket) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}

	const allLogs = await logRepo.list({ ticket_id: ticketId });
	const activeLogs = allLogs.filter((l) => l.status !== 'voided');

	let hasLeftoverOrReturns = false;
	const summaries: ItemReconciliationSummary[] = ticket.items.map((item) => {
		const itemLogs = activeLogs.filter((l) => l.item_id === item.item_id);
		const distributed = itemLogs.reduce((acc, l) => addQty(acc, l.qty), '0');
		const allocated = item.allocated_qty || '0';
		const remainingInHand = subQty(allocated, distributed);

		if (qtyGt(remainingInHand, 0)) {
			hasLeftoverOrReturns = true;
		}

		return {
			item_id: item.item_id,
			item_name: item.item_name,
			allocated_qty: allocated,
			distributed_qty: distributed,
			remaining_in_hand: remainingInHand
		};
	});

	return {
		ticket,
		summaries,
		hasLeftoverOrReturns
	};
}

/**
 * Closes frontline shift, updating ticket summary quantities (Step 5).
 * If all goods were 100% distributed with 0 returns, transitions directly to COMPLETED.
 * If leftovers or returnable items exist, transitions to SHIFT_CLOSED.
 */
export async function closeShift(
	ticketId: string,
	options: ShiftCloseOptions | undefined,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanPerformFrontlineDistribution(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const { ticket, summaries } = await calculateShiftReconciliation(ticketId, ctx, deps);

	if (ticket.status !== 'DISTRIBUTING') {
		throw new TicketStateError(
			`Cannot close shift for ticket ${ticketId} in status '${ticket.status}'; expected DISTRIBUTING`
		);
	}

	const summaryMap = new Map(summaries.map((s) => [s.item_id, s]));
	let totalRemainingToReturn = '0';

	const updatedItems: TicketItem[] = ticket.items.map((item) => {
		const summary = summaryMap.get(item.item_id);
		const distributed = summary ? summary.distributed_qty : item.distributed_qty || '0';
		const remainingInHand = summary ? summary.remaining_in_hand : '0';

		const returned = options?.returned_quantities?.[item.item_id] ?? remainingInHand;
		const allocated = item.allocated_qty || '0';
		const accounted = addQty(distributed, returned);
		const discrepancy = subQty(allocated, accounted);

		totalRemainingToReturn = addQty(totalRemainingToReturn, returned);

		return {
			...item,
			distributed_qty: distributed,
			returned_qty: returned,
			discrepancy_qty: discrepancy
		};
	});

	// If 100% distributed and 0 physical returns remain, ticket can transition to COMPLETED via SHIFT_CLOSED
	const hasReturns = qtyGt(totalRemainingToReturn, 0);

	const closedTicket = await ticketRepo.transitionTicket(ticketId, 'SHIFT_CLOSED', ctx, {
		items: updatedItems
	});

	if (!hasReturns) {
		return ticketRepo.transitionTicket(ticketId, 'COMPLETED', ctx);
	}

	return closedTicket;
}

/**
 * Frontline submits returns back to central warehouse, transitioning SHIFT_CLOSED -> RETURN_PENDING_RECEIPT (Step 6).
 */
export async function submitReturnsToWarehouse(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanPerformFrontlineDistribution(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'SHIFT_CLOSED') {
		throw new TicketStateError(
			`Cannot submit returns for ticket ${ticketId} in status '${current.status}'; expected SHIFT_CLOSED`
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'RETURN_PENDING_RECEIPT', ctx);
}

/**
 * Central warehouse inspects physical returns dockside, creates inbound stock ledger rows,
 * and marks ticket RETURN_COMPLETED (Step 7).
 */
export async function receiveWarehouseReturns(
	ticketId: string,
	options: VerifiedWarehouseReturns | undefined,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<{ ticket: RequisitionTicket; ledgerEntriesCreated: number }> {
	assertCanReceiveWarehouseReturns(ctx);

	const { ticketRepo, operationsRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'RETURN_PENDING_RECEIPT') {
		throw new TicketStateError(
			`Cannot receive warehouse returns for ticket ${ticketId} in status '${current.status}'; expected RETURN_PENDING_RECEIPT`
		);
	}

	// Idempotency check against existing receive ledger entries for this ticket
	const existingLedger = await operationsRepo.listLedger();
	const existingReceiveEntries = existingLedger.filter(
		(e) => e.ref_id === current._id && e.reason === 'receive'
	);
	const existingItems = new Set(existingReceiveEntries.map((e) => e.item_id));

	let ledgerEntriesCreated = 0;
	const updatedItems: TicketItem[] = [];

	for (const item of current.items) {
		const verifiedReturned =
			options?.verified_returned_quantities?.[item.item_id] ?? item.returned_qty ?? '0';

		const allocated = item.allocated_qty || '0';
		const distributed = item.distributed_qty || '0';
		const discrepancy = subQty(subQty(allocated, distributed), verifiedReturned);

		if (qtyGt(verifiedReturned, 0) && !existingItems.has(item.item_id)) {
			const ledgerEntry = createStockLedger(
				{
					item_id: item.item_id,
					qty: verifiedReturned,
					unit: 'ชิ้น',
					reason: 'receive',
					ref_id: current._id,
					lot: { note: 'distribution_return' },
					occurred_at: now()
				},
				ctx
			);
			await operationsRepo.addLedgerEntry(ledgerEntry);
			ledgerEntriesCreated++;
		}

		updatedItems.push({
			...item,
			returned_qty: verifiedReturned,
			discrepancy_qty: discrepancy
		});
	}

	const updatedTicket = await ticketRepo.transitionTicket(ticketId, 'RETURN_COMPLETED', ctx, {
		items: updatedItems
	});

	return {
		ticket: updatedTicket,
		ledgerEntriesCreated
	};
}

/**
 * Completes a ticket after returns have been processed dockside (RETURN_COMPLETED -> COMPLETED)
 * or closes out a shift-closed ticket with no outstanding returns.
 */
export async function completeTicket(
	ticketId: string,
	ctx: AuthorContext,
	deps?: ReconciliationDependencies
): Promise<RequisitionTicket> {
	assertCanReceiveWarehouseReturns(ctx);

	const { ticketRepo } = resolveDependencies(deps, ctx);
	const current = await ticketRepo.get(ticketId);
	if (!current) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (current.status !== 'RETURN_COMPLETED' && current.status !== 'SHIFT_CLOSED') {
		throw new TicketStateError(
			`Cannot complete ticket ${ticketId} in status '${current.status}'; expected RETURN_COMPLETED or SHIFT_CLOSED`
		);
	}

	return ticketRepo.transitionTicket(ticketId, 'COMPLETED', ctx);
}
