import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc, now } from '$lib/db/model';
import { addQty, parseQty, qtyGt, qtyLte, subQty } from '$lib/utils/qty';
import {
	bulkReturnPoolIdSchema,
	distributionLogIdSchema,
	foodSuppliesBaseDocShape,
	mealPeriodSchema,
	type MealPeriod,
	positiveWholeQtySchema,
	nonNegativeWholeQtySchema,
	positiveWholeQtyCoerceSchema,
	requisitionTicketIdSchema,
	thailandCalendarDay
} from './shared';
import type { TicketItem } from './requisition-ticket';

export const distributionRecipientTypeSchema = z.enum(['evacuee', 'volunteer', 'outside']);
export type DistributionRecipientType = z.infer<typeof distributionRecipientTypeSchema>;

export const distributionLogStatusSchema = z.enum([
	'fulfilled',
	'active',
	'partially_returned',
	'returned',
	'lost',
	'waived',
	'voided'
]);
export type DistributionLogStatus = z.infer<typeof distributionLogStatusSchema>;

export const returnConditionSchema = z.enum(['READY', 'MAINTENANCE', 'BROKEN']);
export type ReturnCondition = z.infer<typeof returnConditionSchema>;

export const loanClearReasonSchema = z.enum(['routine', 'bulk_dropoff', 'waived', 'lost']);
export type LoanClearReason = z.infer<typeof loanClearReasonSchema>;

const distributionLogFields = {
	ticket_id: requisitionTicketIdSchema,
	item_id: z.string().min(1),
	meal_service_id: z.string().min(1).optional(),
	recipe_id: z.string().min(1).optional(),
	qty: positiveWholeQtySchema,
	recipient_type: distributionRecipientTypeSchema,
	recipient_id: z.string().min(1).nullable().optional(),
	household_id: z.string().min(1).optional(),
	meal: mealPeriodSchema.optional(),
	is_returnable: z.boolean(),
	status: distributionLogStatusSchema,
	qty_returned: nonNegativeWholeQtySchema.optional(),
	condition_on_return: returnConditionSchema.optional(),
	clear_reason: loanClearReasonSchema.optional(),
	bulk_pool_id: bulkReturnPoolIdSchema.optional(),
	returned_at: z.string().datetime().optional(),
	returned_by: z.string().min(1).optional(),
	is_override: z.boolean(),
	override_reason: z.string().trim().min(1).optional(),
	is_expired_warning: z.boolean().optional(),
	distributed_at: z.string().datetime(),
	distributed_by: z.string().min(1),
	voided_at: z.string().datetime().nullable().optional(),
	voided_by: z.string().min(1).nullable().optional(),
	notes: z.string().trim().min(1).optional()
};

function validateDistributionLog(
	log: z.infer<z.ZodObject<typeof distributionLogFields>>,
	ctx: z.RefinementCtx
): void {
	const recipientId = log.recipient_id;
	if (log.recipient_type === 'evacuee' && (!recipientId || !recipientId.startsWith('evacuee:'))) {
		ctx.addIssue({
			code: 'custom',
			path: ['recipient_id'],
			message: 'evacuee recipient_id is required'
		});
	}
	if (
		log.recipient_type === 'volunteer' &&
		(!recipientId || !recipientId.startsWith('volunteer:'))
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['recipient_id'],
			message: 'volunteer recipient_id is required'
		});
	}
	if (log.recipient_type === 'outside' && recipientId != null) {
		ctx.addIssue({
			code: 'custom',
			path: ['recipient_id'],
			message: 'outside recipients must not carry recipient_id'
		});
	}
	if (!log.is_returnable && !['fulfilled', 'voided'].includes(log.status)) {
		ctx.addIssue({
			code: 'custom',
			path: ['status'],
			message: 'Non-returnable logs end as fulfilled or voided'
		});
	}
	if (
		log.is_returnable &&
		['fulfilled', 'voided'].includes(log.status) &&
		log.status !== 'voided'
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['status'],
			message: 'Returnable logs use the loan lifecycle'
		});
	}
	if (log.qty_returned && !qtyLte(log.qty_returned, log.qty)) {
		ctx.addIssue({
			code: 'custom',
			path: ['qty_returned'],
			message: 'qty_returned cannot exceed qty'
		});
	}
	if (log.status === 'voided' && (!log.voided_at || !log.voided_by)) {
		ctx.addIssue({
			code: 'custom',
			path: ['voided_at'],
			message: 'Voided logs require void audit fields'
		});
	}
	if (
		log.status === 'voided' &&
		log.is_returnable &&
		((log.qty_returned != null && qtyGt(log.qty_returned, 0)) ||
			log.returned_at != null ||
			log.returned_by != null ||
			log.clear_reason != null ||
			log.bulk_pool_id != null)
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['status'],
			message: 'A loan cannot be voided after return or clear activity has begun'
		});
	}
	const requiresReturnAudit = ['partially_returned', 'returned', 'lost', 'waived'].includes(
		log.status
	);
	if (requiresReturnAudit && (!log.returned_at || !log.returned_by || !log.clear_reason)) {
		ctx.addIssue({
			code: 'custom',
			path: ['returned_at'],
			message: 'Loan clear status requires return audit fields'
		});
	}
	if (
		log.status === 'partially_returned' &&
		(!log.qty_returned || !qtyGt(log.qty_returned, 0) || !qtyGt(log.qty, log.qty_returned))
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['qty_returned'],
			message: 'Partial return requires qty_returned greater than zero and less than issued qty'
		});
	}
	if (
		log.status === 'returned' &&
		(!log.qty_returned ||
			!parseQty(log.qty_returned).eq(log.qty) ||
			!['routine', 'bulk_dropoff'].includes(log.clear_reason ?? ''))
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['qty_returned'],
			message: 'Returned log must record the full qty with a successful return clear_reason'
		});
	}
	if (
		(log.status === 'lost' && log.clear_reason !== 'lost') ||
		(log.status === 'waived' && log.clear_reason !== 'waived')
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['clear_reason'],
			message: 'Loan outcome must match its canonical clear_reason'
		});
	}
	if (['lost', 'waived'].includes(log.status) && !log.notes) {
		ctx.addIssue({
			code: 'custom',
			path: ['notes'],
			message: 'Lost or waived loans require notes'
		});
	}
	if (log.clear_reason === 'bulk_dropoff' && !log.bulk_pool_id) {
		ctx.addIssue({
			code: 'custom',
			path: ['bulk_pool_id'],
			message: 'bulk_dropoff requires bulk_pool_id'
		});
	}
	if (log.is_override && !log.override_reason) {
		ctx.addIssue({
			code: 'custom',
			path: ['override_reason'],
			message: 'Override requires override_reason'
		});
	}
}

export const distributionLogDocSchema = z
	.object({
		_id: distributionLogIdSchema,
		type: z.literal('distribution_log'),
		...foodSuppliesBaseDocShape,
		...distributionLogFields
	})
	.superRefine(validateDistributionLog);
export type DistributionLog = BaseDoc & z.infer<typeof distributionLogDocSchema>;

export const distributionLogInputSchema = z
	.object({
		ticket_id: requisitionTicketIdSchema,
		item_id: z.string().min(1),
		meal_service_id: z.string().min(1).optional(),
		recipe_id: z.string().min(1).optional(),
		qty: positiveWholeQtyCoerceSchema,
		recipient_type: distributionRecipientTypeSchema,
		recipient_id: z.string().min(1).nullable().optional(),
		household_id: z.string().min(1).optional(),
		meal: mealPeriodSchema.optional(),
		is_returnable: z.boolean(),
		is_override: z.boolean(),
		override_reason: z.string().trim().min(1).optional(),
		is_expired_warning: z.boolean().optional(),
		distributed_at: z.string().datetime().optional(),
		notes: z.string().trim().min(1).optional()
	})
	.superRefine((input, ctx) =>
		validateDistributionLog(
			{
				...input,
				status: input.is_returnable ? 'active' : 'fulfilled',
				distributed_at: input.distributed_at ?? now(),
				distributed_by: 'input-validation'
			},
			ctx
		)
	);
export type DistributionLogInput = z.input<typeof distributionLogInputSchema>;

export function createDistributionLog(
	input: DistributionLogInput,
	ctx: AuthorContext,
	id?: string
): DistributionLog {
	const parsed = distributionLogInputSchema.parse(input);
	return distributionLogDocSchema.parse(
		makeDoc(
			'distribution_log',
			1,
			{
				...parsed,
				status: parsed.is_returnable ? 'active' : 'fulfilled',
				distributed_at: parsed.distributed_at ?? now(),
				distributed_by: ctx.createdBy
			},
			ctx,
			id
		)
	) as DistributionLog;
}

const IMMUTABLE_LOG_ISSUANCE_FIELDS = [
	'_id',
	'type',
	'schema_v',
	'ticket_id',
	'item_id',
	'qty',
	'recipient_type',
	'recipient_id',
	'household_id',
	'is_returnable',
	'distributed_at',
	'distributed_by',
	'created_at',
	'created_by'
] as const;

/** DistributionLog is durable audit history: issuance facts cannot be rewritten. */
export function assertDistributionLogIssuanceImmutable(
	previous: DistributionLog,
	next: DistributionLog
): void {
	for (const field of IMMUTABLE_LOG_ISSUANCE_FIELDS) {
		if (previous[field] !== next[field]) {
			throw new Error(`distribution_log.${field} is immutable after issuance`);
		}
	}
}

/** A void only reverses an erroneous, untouched issuance; it never erases return history. */
export function assertDistributionLogCanBeVoided(log: DistributionLog): void {
	const terminalOrReturning: DistributionLogStatus[] = [
		'partially_returned',
		'returned',
		'lost',
		'waived'
	];
	if (terminalOrReturning.includes(log.status)) {
		throw new Error(
			`Cannot void distribution log ${log._id} after return or clear activity has begun (status: '${log.status}')`
		);
	}
	if (log.status === 'voided') {
		// already voided — caller should detect this and short-circuit; treat as idempotent
		return;
	}
	if (
		(log.qty_returned != null && qtyGt(log.qty_returned, 0)) ||
		log.returned_at != null ||
		log.returned_by != null ||
		log.clear_reason != null ||
		log.bulk_pool_id != null
	) {
		throw new Error(
			`Cannot void distribution log ${log._id} after return or clear activity has begun`
		);
	}
}

/**
 * Pure predicate checking whether a DistributionLog represents a duplicate meal distribution
 * for the specified meal period on the specified Thailand calendar day.
 * Ignores voided logs and returnable loans.
 */
export function isDuplicateMealDistributionLog(
	log: Pick<DistributionLog, 'status' | 'is_returnable' | 'meal' | 'distributed_at'>,
	targetMeal: MealPeriod,
	referenceIsoOrDate: string | Date = new Date().toISOString()
): boolean {
	if (log.status === 'voided' || log.is_returnable || !log.meal) {
		return false;
	}
	return (
		log.meal === targetMeal &&
		thailandCalendarDay(log.distributed_at) === thailandCalendarDay(referenceIsoOrDate)
	);
}

/**
 * Calculates the total distributed quantity for a specific ticket item from a list of logs.
 * Defensively filters by ticket_id, item_id, and excludes voided logs.
 */
export function calculateDistributedQtyForTicketItem(
	ticketId: string,
	itemId: string,
	logs: readonly DistributionLog[]
): string {
	const validLogs = logs.filter(
		(log) => log.ticket_id === ticketId && log.item_id === itemId && log.status !== 'voided'
	);
	return validLogs.reduce((acc, log) => addQty(acc, log.qty), '0');
}

/**
 * Calculates remaining in-hand quantity for a ticket item given its allocated quantity and logs.
 */
export function calculateInHandQtyForTicketItem(
	ticketId: string,
	targetItem: Pick<TicketItem, 'item_id' | 'allocated_qty'>,
	logs: readonly DistributionLog[]
): string {
	const totalDistributed = calculateDistributedQtyForTicketItem(ticketId, targetItem.item_id, logs);
	const allocated = targetItem.allocated_qty || '0';
	return subQty(allocated, totalDistributed);
}
