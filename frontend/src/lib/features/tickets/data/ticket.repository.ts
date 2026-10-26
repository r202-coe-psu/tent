import type { AuthorContext } from '$lib/db/model';
import type { TicketLotAllocations } from '../domain/ticket-dispatch';
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

	// PENDING_PICK only — kitchen edits its own requested items (CR-142).
	updateTicketItems(
		ticket: RequisitionTicket,
		items: TicketItemInput[]
	): Promise<RequisitionTicket>;

	// PENDING_PICK → READY_FOR_DISPATCH (warehouse_staff/shelter_manager/system_admin — VDU-enforced).
	approveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// Single-write approve: applies allocations (itemId → qty_str) and transitions
	// PENDING_PICK → READY_FOR_DISPATCH in one put.
	approveTicketWithAllocations(
		ticket: RequisitionTicket,
		allocations: Record<string, string>,
		ctx: AuthorContext
	): Promise<RequisitionTicket>;

	// READY_FOR_DISPATCH → IN_TRANSIT (CR-178). `lotsByItem` maps item_id → physical lots the
	// warehouse picked. Validates every line with allocated_qty > 0 against live lot balances
	// (sum = allocated_qty, not expired, <= lot balance, no duplicates) and throws before any
	// write on failure. Then writes one `requisition` stock_ledger row per (item, lot) with a
	// deterministic _id (retry-safe), and the ticket status last.
	dispatchTicket(
		ticket: RequisitionTicket,
		lotsByItem: TicketLotAllocations,
		ctx: AuthorContext
	): Promise<RequisitionTicket>;

	// IN_TRANSIT → COMPLETED — kitchen confirms receipt.
	receiveTicket(ticket: RequisitionTicket, ctx: AuthorContext): Promise<RequisitionTicket>;

	// Pre-dispatch cancel (PENDING_PICK/READY_FOR_DISPATCH only) — no ledger effect.
	cancelTicket(ticket: RequisitionTicket, reason?: string): Promise<RequisitionTicket>;
}
