import type { AuthorContext } from '$lib/db/model';
import type { CreateTicketInput, RequisitionTicket, TicketItemInput } from '../domain/ticket';

export interface TicketRepository {
	// Creates a ticket from a meal plan. Idempotent on `meal_plan_id`: a second
	// call for a plan that already has a non-CANCELLED ticket returns that ticket
	// instead of creating a duplicate (bmad spec — meal_plan_id is the link key).
	createTicket(input: CreateTicketInput, ctx: AuthorContext): Promise<RequisitionTicket>;
	getTicketById(id: string): Promise<RequisitionTicket | null>;
	getActiveTicketByMealPlanId(mealPlanId: string): Promise<RequisitionTicket | null>;
	listTickets(): Promise<RequisitionTicket[]>;

	// PENDING_PICK — warehouse sets the picked qty for one line.
	allocateTicketItem(
		ticket: RequisitionTicket,
		itemId: string,
		allocatedQty: string
	): Promise<RequisitionTicket>;

	// PENDING_PICK only — kitchen edits its own requested items (CR-140).
	updateTicketItems(
		ticket: RequisitionTicket,
		items: TicketItemInput[]
	): Promise<RequisitionTicket>;

	// PENDING_PICK → COMPLETED in one step (CR-141, kitchen only). Auto-allocates
	// every line to requested_qty, checks + deducts stock same as dispatchTicket,
	// and sets approved_by/dispatched_by/received_by together. All-or-nothing.
	oneStepApproveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// PENDING_PICK → READY_FOR_DISPATCH (shelter_manager/system_admin only — VDU-enforced).
	approveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// READY_FOR_DISPATCH → IN_TRANSIT. Checks stock + gas balance, then writes the
	// ticket status update alongside stock_ledger/gas_ledger rows in one bulkDocs
	// call (mirrors kitchen.remote.ts's approveKitchenRequisition). Throws before
	// any write if either balance is insufficient (all-or-nothing).
	dispatchTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// IN_TRANSIT → COMPLETED — kitchen confirms receipt.
	receiveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// Pre-dispatch cancel (PENDING_PICK/READY_FOR_DISPATCH only) — no ledger effect.
	cancelTicket(ticket: RequisitionTicket, reason?: string): Promise<RequisitionTicket>;
}
