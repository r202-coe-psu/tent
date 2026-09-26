import { bulkDocs } from '$lib/db/couch-db';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { touch, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import {
	createTicket as createTicketDoc,
	allocateTicketItem as allocateTicketItemDoc,
	updateTicketRequestedItems as updateTicketRequestedItemsDoc,
	oneStepApproveTicket as oneStepApproveTicketDoc,
	approveTicket as approveTicketDoc,
	markTicketDispatched,
	receiveTicket as receiveTicketDoc,
	cancelTicket as cancelTicketDoc,
	isRequisitionTicket,
	type CreateTicketInput,
	type RequisitionTicket,
	type TicketItemInput
} from '../domain/ticket';
import { nextTicketNo } from '../domain/ticket-no';
import {
	createStockLedger,
	stockBalance,
	isStockLedger,
	type StockLedger
} from '$lib/features/operations';
import { isMealPlan, type MealPlan } from '$lib/features/kitchen';
import { qtyGt, qtyNeg } from '$lib/utils/qty';
import type { TicketRepository } from './ticket.repository';

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

	async oneStepApproveTicket(
		ticket: RequisitionTicket,
		ctx: AuthorContext
	): Promise<RequisitionTicket> {
		const completed = oneStepApproveTicketDoc(ticket, ctx);

		// Same stock-check-then-deduct as dispatchTicket, run against the
		// newly-allocated (= requested_qty) amounts.
		const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const balance = stockBalance(ledger);
		for (const item of completed.items) {
			const onHand = balance.get(item.item_id) ?? '0';
			if (qtyGt(item.allocated_qty, onHand)) {
				throw new Error(
					`oneStepApproveTicket: cannot approve ${item.allocated_qty} ${item.unit} of ${item.item_id} — only ${onHand} on hand`
				);
			}
		}

		const stockLedgerEntries = completed.items.map((item) =>
			createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyNeg(item.allocated_qty),
					unit: item.unit,
					reason: 'requisition',
					ref_id: completed._id
				},
				ctx
			)
		);

		await bulkDocs(this.dbName, [completed, ...stockLedgerEntries]);
		return completed;
	}

	async approveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket> {
		return this.repo.put(approveTicketDoc(ticket, ctx));
	}

	async dispatchTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket> {
		// LPG is temporarily excluded from dispatch. Keep ticket flow usable while
		// cylinder allocation is paused; do not validate or consume gas stock.
		const dispatched = {
			...markTicketDispatched(ticket, ctx),
			gas_drawdown: []
		};

		// 1. Check stock balance for every line before writing anything.
		const ledger = await this.repo.allByType<StockLedger>('stock_ledger', isStockLedger);
		const balance = stockBalance(ledger);
		for (const item of dispatched.items) {
			const onHand = balance.get(item.item_id) ?? '0';
			if (qtyGt(item.allocated_qty, onHand)) {
				throw new Error(
					`dispatchTicket: cannot dispatch ${item.allocated_qty} ${item.unit} of ${item.item_id} — only ${onHand} on hand`
				);
			}
		}

		// 2. Mint stock_ledger rows (reason: requisition, ref_id: this ticket).
		const stockLedgerEntries = dispatched.items.map((item) =>
			createStockLedger(
				{
					item_id: item.item_id,
					qty: qtyNeg(item.allocated_qty),
					unit: item.unit,
					reason: 'requisition',
					ref_id: dispatched._id
				},
				ctx
			)
		);

		// 3. Write ticket status + stock ledger together (all-or-nothing intent —
		// CouchDB _bulk_docs is not a transaction, but every check above already
		// ran before any write, so a partial failure here is a rare race, not a
		// silent shortfall — same guarantee kitchen.remote.ts's
		// approveKitchenRequisition gives today).
		await bulkDocs(this.dbName, [dispatched, ...stockLedgerEntries]);
		return dispatched;
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
