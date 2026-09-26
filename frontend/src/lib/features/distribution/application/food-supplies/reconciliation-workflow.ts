import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { addQty, parseQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import { nonNegativeWholeQtySchema } from '../../domain/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	type OperationsRepository,
	type StockLedger,
	operationsRepository
} from '$lib/features/operations';
import { ConflictError } from '$lib/utils/errors';
import type { RequisitionTicket, TicketItem } from '../../domain/food-supplies';
import {
	DistributionLogRemoteRepository,
	type DistributionLogRepository,
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution, assertCanReceiveWarehouseReturns } from './auth';
import { StockIntegrityError, TicketStateError, WorkflowValidationError } from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { resolveCanonicalItemUnits, type CanonicalUnitCatalogRepository } from './canonical-unit';

function assertWarehouseReturnLedgerSemantics(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext,
	expectedId: string,
	expectedLotRef: string | undefined = expected.lot_ref
): void {
	assertLedgerReplayBase(
		actual,
		{
			id: expectedId,
			schemaVersion: expected.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'receive',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expectedLotRef
		},
		`Warehouse return ledger replay mismatch for ${expected._id}`
	);
	if (actual.lot?.note !== 'distribution_return') {
		throw new StockIntegrityError(`Warehouse return ledger replay mismatch for ${expected._id}`);
	}
}

export interface ReconciliationDependencies {
	ticketRepo?: RequisitionTicketRepository;
	logRepo?: DistributionLogRepository;
	operationsRepo?: OperationsRepository;
	catalogRepo?: CanonicalUnitCatalogRepository;
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
	const isCompletedReplay = current.status === 'RETURN_COMPLETED';
	if (current.status !== 'RETURN_PENDING_RECEIPT' && !isCompletedReplay) {
		throw new TicketStateError(
			`Cannot receive warehouse returns for ticket ${ticketId} in status '${current.status}'; expected RETURN_PENDING_RECEIPT`
		);
	}
	const itemUnits = await resolveCanonicalItemUnits(
		current.items.map((item) => item.item_id),
		ctx,
		deps?.catalogRepo
	);

	const requestedQuantities = options?.verified_returned_quantities ?? {};
	const ticketItemIds = new Set(current.items.map((item) => item.item_id));
	for (const itemId of Object.keys(requestedQuantities)) {
		if (!ticketItemIds.has(itemId)) {
			throw new WorkflowValidationError(
				`Cannot receive warehouse return for unknown ticket item ${itemId}`
			);
		}
	}

	const verifiedByItem = new Map<string, string>();
	for (const item of current.items) {
		const rawVerified = requestedQuantities[item.item_id] ?? item.returned_qty ?? '0';
		const parsedVerified = nonNegativeWholeQtySchema.safeParse(rawVerified);
		if (!parsedVerified.success) {
			throw new WorkflowValidationError(
				`Warehouse verified return for ${item.item_id} must be a non-negative whole number`
			);
		}
		const verifiedQty = parsedVerified.data;

		const expectedReturn = item.returned_qty ?? '0';
		const remainingAfterDistribution = subQty(item.allocated_qty, item.distributed_qty ?? '0');
		if (!qtyLte(verifiedQty, expectedReturn)) {
			throw new WorkflowValidationError(
				`Warehouse verified return for ${item.item_id} cannot exceed the ${expectedReturn} sent from the shift`
			);
		}
		if (!qtyLte(verifiedQty, remainingAfterDistribution)) {
			throw new StockIntegrityError(
				`Warehouse verified return for ${item.item_id} exceeds its ${remainingAfterDistribution} ticket remainder`
			);
		}
		verifiedByItem.set(item.item_id, verifiedQty);
	}

	// Idempotency check against existing receive ledger entries for this ticket
	const existingLedger = await operationsRepo.listLedger();
	const existingReceiveEntries = existingLedger.filter(
		(e) => e.ref_id === current._id && e.reason === 'receive'
	);
	const existingByItem = new Map<string, typeof existingReceiveEntries>();
	for (const entry of existingReceiveEntries) {
		if (!ticketItemIds.has(entry.item_id)) {
			throw new StockIntegrityError(
				`Warehouse return ledger ${entry._id} references unknown ticket item ${entry.item_id}`
			);
		}
		const itemEntries = existingByItem.get(entry.item_id) ?? [];
		itemEntries.push(entry);
		existingByItem.set(entry.item_id, itemEntries);
	}

	const buildExpectedLedger = async (item: TicketItem, qty: string): Promise<StockLedger> => {
		const unit = itemUnits.get(item.item_id);
		if (!unit) {
			throw new StockIntegrityError(
				`Missing canonical unit for warehouse return item ${item.item_id}`
			);
		}
		const ledgerId = await deriveDeterministicLedgerId(
			'warehouse_return',
			current._id,
			item.item_id
		);
		return createStockLedger(
			{
				item_id: item.item_id,
				qty,
				unit,
				reason: 'receive',
				ref_id: current._id,
				lot: { note: 'distribution_return' },
				occurred_at: now()
			},
			ctx,
			ledgerId
		);
	};

	if (isCompletedReplay) {
		for (const item of current.items) {
			const verifiedReturned = verifiedByItem.get(item.item_id)!;
			const discrepancy = subQty(
				subQty(item.allocated_qty, item.distributed_qty || '0'),
				verifiedReturned
			);
			if (
				item.returned_qty === undefined ||
				!parseQty(item.returned_qty).eq(verifiedReturned) ||
				item.discrepancy_qty === undefined ||
				!parseQty(item.discrepancy_qty).eq(discrepancy)
			) {
				throw new StockIntegrityError(
					`Completed warehouse return reconciliation for ${item.item_id} does not match the requested final quantities`
				);
			}

			const existingItemEntries = existingByItem.get(item.item_id) ?? [];
			if (existingItemEntries.length > 1) {
				throw new StockIntegrityError(
					`Multiple warehouse return ledger rows exist for ticket item ${item.item_id}`
				);
			}
			if (qtyGt(verifiedReturned, 0)) {
				if (existingItemEntries.length !== 1) {
					throw new StockIntegrityError(
						`Completed warehouse return receipt for ${item.item_id} is missing`
					);
				}
				const expectedLedger = await buildExpectedLedger(item, verifiedReturned);
				assertWarehouseReturnLedgerSemantics(
					existingItemEntries[0],
					expectedLedger,
					ctx,
					expectedLedger._id
				);
			} else if (existingItemEntries.length !== 0) {
				throw new StockIntegrityError(
					`Zero-quantity warehouse return for ${item.item_id} cannot have a receipt ledger row`
				);
			}
		}

		return { ticket: current, ledgerEntriesCreated: 0 };
	}

	let ledgerEntriesCreated = 0;
	const updatedItems: TicketItem[] = [];

	for (const item of current.items) {
		const verifiedReturned = verifiedByItem.get(item.item_id)!;

		const allocated = item.allocated_qty || '0';
		const distributed = item.distributed_qty || '0';
		const discrepancy = subQty(subQty(allocated, distributed), verifiedReturned);

		const existingItemEntries = existingByItem.get(item.item_id) ?? [];
		if (existingItemEntries.length > 1) {
			throw new StockIntegrityError(
				`Multiple warehouse return ledger rows exist for ticket item ${item.item_id}`
			);
		}
		if (existingItemEntries.length === 1) {
			if (!qtyGt(verifiedReturned, 0)) {
				throw new StockIntegrityError(
					`Zero-quantity warehouse return for ${item.item_id} cannot have a receipt ledger row`
				);
			}
			const [existingEntry] = existingItemEntries;
			if (!existingEntry) {
				throw new StockIntegrityError(`Warehouse return ledger for ${item.item_id} is missing`);
			}
			const expectedLedger = await buildExpectedLedger(item, verifiedReturned);

			assertWarehouseReturnLedgerSemantics(
				existingEntry,
				expectedLedger,
				ctx,
				existingEntry._id,
				existingEntry.lot_ref
			);
		} else if (qtyGt(verifiedReturned, 0)) {
			const ledgerEntry = await buildExpectedLedger(item, verifiedReturned);
			try {
				await operationsRepo.addLedgerEntry(ledgerEntry);
				ledgerEntriesCreated++;
			} catch (error) {
				if (!(error instanceof ConflictError)) throw error;
				const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerEntry._id);
				if (!recoveredLedger) {
					throw new StockIntegrityError(
						`ConflictError on ${ledgerEntry._id} but existing warehouse return ledger could not be fetched`
					);
				}
				assertWarehouseReturnLedgerSemantics(recoveredLedger, ledgerEntry, ctx, ledgerEntry._id);
			}
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
