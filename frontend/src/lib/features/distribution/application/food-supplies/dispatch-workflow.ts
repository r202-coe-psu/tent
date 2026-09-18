import type { AuthorContext } from '$lib/db/model';
import { now } from '$lib/db/model';
import { isUlid, ulid } from '$lib/db/ulid';
import { addQty, parseQty, qtyGt, qtyNeg } from '$lib/utils/qty';
import { ConflictError } from '$lib/utils/errors';
import {
	createStockLedger,
	type OperationsRepository,
	type StockLedger,
	operationsRepository
} from '$lib/features/operations';
import type { RequisitionTicket, TicketAmendment } from '../../domain/food-supplies';
import {
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanDispatchTicket } from './auth';
import { StockIntegrityError, TicketStateError, WorkflowValidationError } from './errors';
import { assertLedgerReplayBase } from './ledger-replay';
import { assertPositiveQty } from './validation';

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
	/**
	 * Stable caller-supplied ULID representing the durable amendment identity.
	 * Callers MUST reuse this ID across sequential retries to prevent double-debit.
	 */
	amendmentId: string;
	item_id: string;
	added_qty: string;
	reason?: string;
	lot_ref?: string;
}

function assertAmendmentLedgerReplay(
	actual: StockLedger,
	expected: StockLedger,
	ctx: AuthorContext
): void {
	assertLedgerReplayBase(
		actual,
		{
			id: expected._id,
			schemaVersion: expected.schema_v,
			shelterCode: ctx.shelterCode,
			reason: 'distribute',
			refId: expected.ref_id,
			itemId: expected.item_id,
			qty: expected.qty,
			unit: expected.unit,
			lotRef: expected.lot_ref
		},
		`Amendment ledger replay mismatch for ${expected._id}`
	);
}

function assertAmendmentReplay(actual: TicketAmendment, expected: TicketAmendment): void {
	if (
		actual.amendment_id !== expected.amendment_id ||
		actual.item_id !== expected.item_id ||
		!parseQty(actual.added_qty).eq(expected.added_qty) ||
		(actual.reason || '') !== (expected.reason || '')
	) {
		throw new StockIntegrityError(`Ticket amendment replay mismatch for ${expected.amendment_id}`);
	}
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
 * Uses caller-supplied or pre-write generated amendment_id to guarantee deterministic
 * outbound StockLedger identity and retry-safety across network or CAS failures.
 */
export async function amendActiveTicket(
	ticketId: string,
	input: InFlightAmendmentInput,
	ctx: AuthorContext,
	deps?: DispatchWorkflowDependencies
): Promise<RequisitionTicket> {
	assertCanDispatchTicket(ctx);

	assertPositiveQty(input.added_qty, 'Amendment added_qty');

	const amendmentId = input.amendmentId;
	if (!isUlid(amendmentId)) {
		throw new WorkflowValidationError('amendmentId must be a valid ULID');
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
			: `stock_ledger:${amendmentId}`;

	// Write outbound deduction for top-up with deterministic ledger identity
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
		ctx,
		amendmentId
	);
	const ledgerId = ledgerEntry._id;

	const intendedAmendment: TicketAmendment = {
		amendment_id: amendmentId,
		item_id: input.item_id,
		added_qty: input.added_qty,
		amended_at: now(),
		amended_by: ctx.createdBy,
		reason: input.reason || 'Frontline radio top-up request'
	};

	// Check if ticket already contains this amendment (COMPLETE or AMENDMENT_ONLY state)
	const existingAmendment = current.amendments?.find((a) => a.amendment_id === amendmentId);
	if (existingAmendment) {
		assertAmendmentReplay(existingAmendment, intendedAmendment);

		const existingLedger = await operationsRepo.getLedgerEntry(ledgerId);
		if (!existingLedger) {
			// AMENDMENT_ONLY: amendment exists on ticket but outbound ledger is missing (fail closed)
			throw new StockIntegrityError(
				`Ticket amendment ${amendmentId} exists on ticket ${ticketId} without its deterministic outbound ledger ${ledgerId}`
			);
		}
		assertAmendmentLedgerReplay(existingLedger, ledgerEntry, ctx);
		return current;
	}

	// NONE or LEDGER_ONLY state: attempt to write ledger; recover on ConflictError
	try {
		const persistedLedger = await operationsRepo.addLedgerEntry(ledgerEntry);
		assertAmendmentLedgerReplay(persistedLedger, ledgerEntry, ctx);
	} catch (error) {
		if (!(error instanceof ConflictError)) {
			throw error;
		}
		// LEDGER_ONLY recovery: deterministic ledger already written — fetch and verify
		const recoveredLedger = await operationsRepo.getLedgerEntry(ledgerId);
		if (!recoveredLedger) {
			throw new StockIntegrityError(
				`ConflictError on ${ledgerId} but existing ledger could not be fetched — unrecoverable state`
			);
		}
		assertAmendmentLedgerReplay(recoveredLedger, ledgerEntry, ctx);
	}

	// Update ticket with amendment
	return ticketRepo.mutateTicketCAS(
		ticketId,
		(ticket) => {
			const existing = ticket.amendments?.find((a) => a.amendment_id === amendmentId);
			if (existing) {
				assertAmendmentReplay(existing, intendedAmendment);
				return ticket;
			}

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
				amendments: [...(ticket.amendments || []), intendedAmendment]
			};
		},
		ctx
	);
}
