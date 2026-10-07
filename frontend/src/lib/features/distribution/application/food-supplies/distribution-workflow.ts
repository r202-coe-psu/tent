import type { AuthorContext } from '$lib/db/model';
import { qtyGte } from '$lib/utils/qty';
import {
	assertDistributionLogCanBeVoided,
	calculateInHandQtyForTicketItem,
	isDuplicateMealDistributionLog,
	type DistributionLog,
	type DistributionRecipientType,
	type RequisitionTicket,
	type TicketItem
} from '../../domain/food-supplies';
import {
	DistributionLogRemoteRepository,
	type DistributionLogRepository,
	RequisitionTicketRemoteRepository,
	type RequisitionTicketRepository
} from '../../data/food-supplies';
import { assertCanPerformFrontlineDistribution } from './auth';
import { CapacityExceededError, TicketStateError, WorkflowValidationError } from './errors';
import { assertPositiveIntegerQty } from './validation';

export interface DistributionWorkflowDependencies {
	ticketRepo?: RequisitionTicketRepository;
	logRepo?: DistributionLogRepository;
}

export interface FoodDistributionInput {
	item_id: string;
	qty: string;
	recipient_type: DistributionRecipientType;
	recipient_id?: string | null;
	household_id?: string;
	meal_service_id?: string;
	recipe_id?: string;
	is_override?: boolean;
	override_reason?: string;
	cooking_completed_at?: string;
	notes?: string;
}

export interface SuppliesDistributionInput {
	item_id: string;
	qty: string;
	recipient_type: DistributionRecipientType;
	recipient_id?: string | null;
	household_id?: string;
	is_override?: boolean;
	override_reason?: string;
	notes?: string;
}

function resolveDependencies(
	deps: DistributionWorkflowDependencies | undefined,
	ctx: AuthorContext
): { ticketRepo: RequisitionTicketRepository; logRepo: DistributionLogRepository } {
	return {
		ticketRepo: deps?.ticketRepo ?? new RequisitionTicketRemoteRepository(ctx.shelterCode),
		logRepo: deps?.logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode)
	};
}

const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

/** Resolves a requested item from a Ticket that is actively distributing the expected flow type. */
async function resolveDistributingTicketItem(
	ticketRepo: RequisitionTicketRepository,
	ticketId: string,
	expectedType: 'food' | 'supplies',
	itemId: string
): Promise<{ ticket: RequisitionTicket; targetItem: TicketItem }> {
	const ticket = await ticketRepo.get(ticketId);
	if (!ticket) {
		throw new TicketStateError(`Ticket ${ticketId} not found`);
	}
	if (ticket.status !== 'DISTRIBUTING') {
		throw new TicketStateError(
			`Cannot distribute from ticket ${ticketId} in status '${ticket.status}'; expected DISTRIBUTING`
		);
	}
	if (ticket.requisition_type !== expectedType) {
		throw new WorkflowValidationError(
			`Ticket ${ticketId} is of type '${ticket.requisition_type}', not '${expectedType}'`
		);
	}

	const targetItem = ticket.items.find((item) => item.item_id === itemId);
	if (!targetItem) {
		throw new WorkflowValidationError(`Item ${itemId} not found on ticket ${ticketId}`);
	}

	return { ticket, targetItem };
}

/** Calculates in-hand quantity from non-voided issuance logs without mutating the Ticket. */
async function assertSufficientInHandCapacity(
	logRepo: DistributionLogRepository,
	ticketId: string,
	targetItem: TicketItem,
	requestedQty: string
): Promise<void> {
	const existingLogs = await logRepo.list({ ticket_id: ticketId, item_id: targetItem.item_id });
	const inHand = calculateInHandQtyForTicketItem(ticketId, targetItem, existingLogs);

	if (!qtyGte(inHand, requestedQty)) {
		throw new CapacityExceededError(
			`Insufficient in-hand quantity for item ${targetItem.item_name}. In-hand: ${inHand}, Requested: ${requestedQty}`
		);
	}
}

/**
 * Distributes ready meals / food at frontline distribution point (Step 4B).
 * Creates append-only DistributionLog with status 'fulfilled'. Never mutates Ticket document.
 */
export async function recordFoodDistribution(
	ticketId: string,
	input: FoodDistributionInput,
	ctx: AuthorContext,
	deps?: DistributionWorkflowDependencies
): Promise<DistributionLog> {
	assertCanPerformFrontlineDistribution(ctx);

	assertPositiveIntegerQty(input.qty, 'Distribution qty');

	const { ticketRepo, logRepo } = resolveDependencies(deps, ctx);
	const { ticket, targetItem } = await resolveDistributingTicketItem(
		ticketRepo,
		ticketId,
		'food',
		input.item_id
	);
	await assertSufficientInHandCapacity(logRepo, ticketId, targetItem, input.qty);

	// Food duplicate check (advisory query per CR-121 FR-DST-02)
	if (input.recipient_id && ticket.meal) {
		const recentRecipientLogs = await logRepo.list({ recipient_id: input.recipient_id });
		const duplicate = recentRecipientLogs.some((l) =>
			isDuplicateMealDistributionLog(l, ticket.meal!)
		);
		if (duplicate && !input.is_override) {
			throw new WorkflowValidationError(
				`Recipient ${input.recipient_id} has already received a meal for period '${ticket.meal}'. Override required.`
			);
		}
	}

	// 4-Hour Food Safety Countdown Check (CR-121 FR-DST-03)
	let isExpiredWarning = false;
	if (input.cooking_completed_at) {
		const cookingTime = new Date(input.cooking_completed_at).getTime();
		if (!isNaN(cookingTime) && Date.now() - cookingTime > FOUR_HOURS_MS) {
			isExpiredWarning = true;
		}
	}

	return logRepo.create(
		{
			ticket_id: ticketId,
			item_id: input.item_id,
			qty: input.qty,
			recipient_type: input.recipient_type,
			recipient_id: input.recipient_id,
			household_id: input.household_id,
			meal: ticket.meal,
			meal_service_id: input.meal_service_id,
			recipe_id: input.recipe_id,
			is_returnable: false,
			status: 'fulfilled',
			is_override: input.is_override ?? false,
			override_reason: input.override_reason,
			is_expired_warning: isExpiredWarning,
			notes: input.notes
		},
		ctx
	);
}

/**
 * Distributes supplies (consumable or returnable loans) at frontline (Step 4B).
 * Consumable: is_returnable=false, status='fulfilled'.
 * Returnable (Loan): is_returnable=true, status='active'.
 */
export async function recordSuppliesDistribution(
	ticketId: string,
	input: SuppliesDistributionInput,
	ctx: AuthorContext,
	deps?: DistributionWorkflowDependencies
): Promise<DistributionLog> {
	assertCanPerformFrontlineDistribution(ctx);

	assertPositiveIntegerQty(input.qty, 'Distribution qty');

	const { ticketRepo, logRepo } = resolveDependencies(deps, ctx);
	const { targetItem } = await resolveDistributingTicketItem(
		ticketRepo,
		ticketId,
		'supplies',
		input.item_id
	);
	await assertSufficientInHandCapacity(logRepo, ticketId, targetItem, input.qty);

	const isReturnable = Boolean(targetItem.returnable);
	if (isReturnable && !input.recipient_id) {
		throw new WorkflowValidationError('Returnable item loans require an identifiable recipient_id');
	}

	return logRepo.create(
		{
			ticket_id: ticketId,
			item_id: input.item_id,
			qty: input.qty,
			recipient_type: input.recipient_type,
			recipient_id: input.recipient_id,
			household_id: input.household_id,
			is_returnable: isReturnable,
			status: isReturnable ? 'active' : 'fulfilled',
			is_override: input.is_override ?? false,
			override_reason: input.override_reason,
			notes: input.notes
		},
		ctx
	);
}

/**
 * Voids an erroneous distribution log (Step 4C / FR-DST-07).
 */
export async function voidDistributionLog(
	logId: string,
	reason: string | undefined,
	ctx: AuthorContext,
	logRepo?: DistributionLogRepository
): Promise<DistributionLog> {
	assertCanPerformFrontlineDistribution(ctx);

	const repository = logRepo ?? new DistributionLogRemoteRepository(ctx.shelterCode);
	const current = await repository.get(logId);
	if (current && current.status !== 'voided') {
		assertDistributionLogCanBeVoided(current);
	}
	return repository.recordVoid(logId, ctx, reason);
}
