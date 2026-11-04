import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import {
	createTicket as createTicketDoc,
	allocateTicketItem as allocateTicketItemDoc,
	updateTicketRequestedItems as updateTicketRequestedItemsDoc,
	approveTicket as approveTicketDoc,
	approveTicketWithAllocations as approveTicketWithAllocationsDoc,
	markTicketDispatched,
	receiveTicket as receiveTicketDoc,
	cancelTicket as cancelTicketDoc,
	isRequisitionTicket,
	type CreateTicketInput,
	type RequisitionTicket,
	type TicketItem,
	type TicketItemInput
} from '../domain/ticket';
import { describeLotFailure, type TicketLotAllocations } from '../domain/ticket-dispatch';
import { nextTicketNo } from '../domain/ticket-no';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	isLotExpired,
	isStockLedger,
	projectStockLotBalances,
	toLotPriorityItems,
	type StockLedger
} from '$lib/features/operations';
import { catalogRepository } from '$lib/features/catalog';
import {
	validateDispatchLotAllocations,
	type DispatchLotAllocation,
	type DispatchLotCandidate
} from '$lib/features/distribution';
import { isMealPlan, type MealPlan } from '$lib/features/kitchen';
import { ConflictError } from '$lib/utils/errors';
import { parseQty, qtyGt, qtyNeg } from '$lib/utils/qty';
import type { TicketRepository } from './ticket.repository';

/** Deterministic `_id` of a kitchen dispatch row — one per (ticket, item, lot) so a retry never double-deducts. */
function deriveDispatchLedgerId(ticketId: string, itemId: string, lotRef: string): Promise<string> {
	return deriveDeterministicLedgerId('requisition', ticketId, itemId, lotRef);
}

export class TicketRemoteRepository implements TicketRepository {
	private readonly dbName: string;
	private readonly repo: Repository;

	constructor(dbName: string) {
		this.dbName = dbName;
		this.repo = createRemoteRepository(dbName);
	}

	listTickets(): Promise<RequisitionTicket[]> {
		return this.repo.allByType('requisition_ticket', isRequisitionTicket);
	}

	getTicketById(id: string): Promise<RequisitionTicket | null> {
		return this.repo.get<RequisitionTicket>(id);
	}

	async getActiveTicketByMealPlanId(mealPlanId: string): Promise<RequisitionTicket | null> {
		const tickets = await this.listTickets();
		return tickets.find((t) => t.meal_plan_id === mealPlanId && t.status !== 'CANCELLED') ?? null;
	}

	async createTicket(input: CreateTicketInput, ctx: AuthorContext): Promise<RequisitionTicket> {
		const existing = await this.getActiveTicketByMealPlanId(input.meal_plan_id);
		if (existing) return existing;

		const tickets = await this.listTickets();
		const ticketNo = nextTicketNo(
			tickets.map((t) => t.ticket_no),
			'kitchen'
		);
		const ticket = createTicketDoc(input, ticketNo, ctx);
		const saved = await this.repo.put(ticket);

		// A plan a ticket now references is no longer a freely editable/deletable
		// draft (updateMealPlanDraft/deleteMealPlanDraft only guard on
		// plan.status, not "does a ticket exist for it") — confirm it here, same
		// point in the flow kitchen_requisition used to (mirrors
		// kitchen.remote.ts's approveKitchenRequisition confirming the plan).
		const plan = await this.repo.get<MealPlan>(input.meal_plan_id);
		if (plan && isMealPlan(plan) && plan.status === 'draft') {
			await this.repo.put({ ...touch(plan), status: 'confirmed' });
		}

		return saved;
	}

	async allocateTicketItem(
		ticket: RequisitionTicket,
		itemId: string,
		allocatedQty: string
	): Promise<RequisitionTicket> {
		return this.repo.put(allocateTicketItemDoc(ticket, itemId, allocatedQty));
	}

	async updateTicketItems(
		ticket: RequisitionTicket,
		items: TicketItemInput[]
	): Promise<RequisitionTicket> {
		return this.repo.put(updateTicketRequestedItemsDoc(ticket, items));
	}

	async approveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket> {
		return this.repo.put(approveTicketDoc(ticket, ctx));
	}

	async approveTicketWithAllocations(
		ticket: RequisitionTicket,
		allocations: Record<string, string>,
		ctx: AuthorContext
	): Promise<RequisitionTicket> {
		return this.repo.put(approveTicketWithAllocationsDoc(ticket, allocations, ctx));
	}

	/**
	 * READY_FOR_DISPATCH → IN_TRANSIT, deducting stock per physical lot (CR-178, same shape as
	 * CR-175 distribution dispatch).
	 *
	 * Write order: validate every line first (nothing written on failure), then one
	 * `stock_ledger` row per (item, lot) with a deterministic `_id`, and the ticket status LAST.
	 * We deliberately do not use `bulkDocs` any more: a retry (double click, network drop, or a
	 * crash between the ledger and the ticket write) re-derives the same ids, so a ConflictError
	 * on a ledger row means "already written" and is verified + skipped instead of deducting
	 * twice; the ticket stays READY_FOR_DISPATCH until its own write lands, so the retry is
	 * always possible. The ticket's own rows are excluded from the lot balances so the retry
	 * still validates.
	 */
	async dispatchTicket(
		ticket: RequisitionTicket,
		lotsByItem: TicketLotAllocations,
		ctx: AuthorContext
	): Promise<RequisitionTicket> {
		const dispatched = markTicketDispatched(ticket, ctx);
		// Lines the warehouse allocated 0 to ("ไม่มีให้") are skipped entirely.
		const suppliedItems = dispatched.items.filter((i) => qtyGt(i.allocated_qty, 0));

		// Phase 1 — validate every line before writing anything.
		const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const masters = await catalogRepository().listItemMasters(ctx.shelterCode);
		const priorityItems = toLotPriorityItems(masters);
		const nowMs = Date.now();
		const rows: { item: TicketItem; allocation: DispatchLotAllocation; ledgerId: string }[] = [];
		for (const item of suppliedItems) {
			const allocations = lotsByItem[item.item_id] ?? [];
			const ownIds = new Set<string>();
			const ids = new Map<string, string>();
			for (const allocation of allocations) {
				if (typeof allocation.lot_ref !== 'string') continue;
				const id = await deriveDispatchLedgerId(dispatched._id, item.item_id, allocation.lot_ref);
				ownIds.add(id);
				ids.set(allocation.lot_ref, id);
			}
			const balances = projectStockLotBalances(
				ledger.filter((entry) => entry.item_id === item.item_id && !ownIds.has(entry._id))
			).filter((lot) => lot.item_id === item.item_id && qtyGt(lot.qty, 0));
			const candidates: DispatchLotCandidate[] = balances.map((lot) => ({
				lot_ref: lot.lot_ref,
				qty: lot.qty,
				expired: isLotExpired(lot, nowMs, priorityItems.get(item.item_id))
			}));
			const result = validateDispatchLotAllocations(item.allocated_qty, allocations, candidates);
			if (!result.ok) {
				throw new Error(describeLotFailure(item.item_name, item.allocated_qty, result));
			}
			for (const allocation of allocations) {
				rows.push({ item, allocation, ledgerId: ids.get(allocation.lot_ref)! });
			}
		}

		// Phase 2 — one ledger row per (item, lot), idempotent on its deterministic id.
		for (const { item, allocation, ledgerId } of rows) {
			const entry = createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyNeg(allocation.qty),
					unit: item.unit,
					reason: 'requisition',
					ref_id: dispatched._id,
					lot_ref: allocation.lot_ref
				},
				ctx,
				ledgerId
			);
			try {
				await this.repo.put(entry);
			} catch (error) {
				if (!(error instanceof ConflictError)) throw error;
				const existing = await this.repo.get<StockLedger>(ledgerId);
				if (
					!existing ||
					existing.item_id !== entry.item_id ||
					existing.lot_ref !== entry.lot_ref ||
					existing.ref_id !== entry.ref_id ||
					!parseQty(existing.qty).eq(entry.qty)
				) {
					throw new Error(
						`dispatchTicket: ledger ${ledgerId} already exists with different content`,
						{ cause: error }
					);
				}
			}
		}

		// Phase 3 — the ticket status goes last.
		return this.repo.put(dispatched);
	}

	async receiveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket> {
		return this.repo.put(receiveTicketDoc(ticket, ctx));
	}

	async cancelTicket(ticket: RequisitionTicket, reason?: string): Promise<RequisitionTicket> {
		return this.repo.put(cancelTicketDoc(ticket, reason));
	}
}

let singleton: TicketRepository | null = null;
let singletonDbName: string | null = null;

export function ticketRepository(): TicketRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new TicketRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
