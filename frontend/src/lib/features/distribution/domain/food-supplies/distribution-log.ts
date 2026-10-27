import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc, now } from '$lib/db/model';
import { addQty, parseQty, qtyGt, qtyIsZero, qtyLte, subQty } from '$lib/utils/qty';
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
import { bulkReturnEntryIdSchema } from './bulk-return-entry';
import type { TicketItem } from './requisition-ticket';

/**
 * schema_v 1: legacy. schema_v 2 (#658): adds `applied_bulk_entry_ids` for the v3 bulk return path.
 * A v1 doc is lazily upgraded to 2 the first time the bulk path writes the field; never 2 -> 1.
 */
export const DISTRIBUTION_LOG_SCHEMA_V = 2;
const distributionLogSchemaVSchema = z.union([z.literal(1), z.literal(2)]);

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
	// Legacy bulk path: existing values stay readable and are carried unchanged; the v3 path never
	// writes it.
	bulk_pool_id: bulkReturnPoolIdSchema.optional(),
	// v3 bulk path (schema_v 2 only): ids of the bulk_return_entry docs applied to this loan.
	applied_bulk_entry_ids: z.array(bulkReturnEntryIdSchema).optional(),
	returned_at: z.string().datetime().optional(),
	returned_by: z.string().min(1).optional(),
	is_override: z.boolean(),
	override_reason: z.string().trim().min(1).optional(),
	/** #607 — `allergy` codes the recipient is allergic to that the item contains (overridden). */
	allergen_conflicts: z.array(z.string().min(1)).optional(),
	is_expired_warning: z.boolean().optional(),
	distributed_at: z.string().datetime(),
	distributed_by: z.string().min(1),
	voided_at: z.string().datetime().nullable().optional(),
	voided_by: z.string().min(1).nullable().optional(),
	notes: z.string().trim().min(1).optional()
};

function validateDistributionLog(
	log: z.infer<z.ZodObject<typeof distributionLogFields>> & { schema_v?: 1 | 2 },
	ctx: z.RefinementCtx
): void {
	const appliedIds = log.applied_bulk_entry_ids;
	if (appliedIds !== undefined) {
		if (log.schema_v === 1) {
			ctx.addIssue({
				code: 'custom',
				path: ['applied_bulk_entry_ids'],
				message: 'applied_bulk_entry_ids requires schema_v 2'
			});
		}
		if (new Set(appliedIds).size !== appliedIds.length) {
			ctx.addIssue({
				code: 'custom',
				path: ['applied_bulk_entry_ids'],
				message: 'applied_bulk_entry_ids must not contain duplicates'
			});
		}
	}
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
			log.bulk_pool_id != null ||
			(log.applied_bulk_entry_ids?.length ?? 0) > 0)
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
	if (
		log.clear_reason === 'bulk_dropoff' &&
		!log.bulk_pool_id &&
		log.applied_bulk_entry_ids === undefined
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['bulk_pool_id'],
			message: 'bulk_dropoff requires bulk_pool_id or applied_bulk_entry_ids'
		});
	}
	if (log.allergen_conflicts?.length && !log.is_override) {
		ctx.addIssue({
			code: 'custom',
			path: ['allergen_conflicts'],
			message: 'Allergen conflicts require an override'
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
		schema_v: distributionLogSchemaVSchema,
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
		allergen_conflicts: z.array(z.string().min(1)).optional(),
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
			DISTRIBUTION_LOG_SCHEMA_V,
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

/**
 * DistributionLog is durable audit history: issuance facts cannot be rewritten. schema_v may stay
 * equal or upgrade 1 -> 2 (lazy upgrade by the v3 bulk path), never downgrade.
 */
export function assertDistributionLogIssuanceImmutable(
	previous: DistributionLog,
	next: DistributionLog
): void {
	assertSchemaVNotDowngraded(previous, next);
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
		log.bulk_pool_id != null ||
		(log.applied_bulk_entry_ids?.length ?? 0) > 0
	) {
		throw new Error(
			`Cannot void distribution log ${log._id} after return or clear activity has begun`
		);
	}
}

/** The v3 bulk path may only upgrade the doc 1 -> 2; it never downgrades. */
function assertSchemaVNotDowngraded(previous: DistributionLog, next: DistributionLog): void {
	const prev = previous.schema_v;
	const nxt = next.schema_v;
	if (prev !== nxt && !(prev === 1 && nxt === 2)) {
		throw new Error('distribution_log.schema_v may only stay equal or upgrade 1 -> 2');
	}
}

export interface BulkEntryRef {
	entry_id: string;
	qty: string;
}

/**
 * Pure v3 bulk APPLY: records one `bulk_return_entry` against a loan. Idempotent — when `entry_id`
 * is already in applied_bulk_entry_ids the log is returned unchanged (same reference). Throws when
 * the loan is not returnable / not active|partially_returned, or `qty` exceeds the outstanding
 * (qty - qty_returned). Upgrades schema_v to 2; carries any legacy bulk_pool_id unchanged and never
 * writes one.
 */
export function applyBulkEntryToLog(
	log: DistributionLog,
	ref: BulkEntryRef,
	actor: string,
	at: string
): DistributionLog {
	bulkReturnEntryIdSchema.parse(ref.entry_id);
	const applied = log.applied_bulk_entry_ids ?? [];
	if (applied.includes(ref.entry_id)) return log;
	if (!log.is_returnable || !['active', 'partially_returned'].includes(log.status)) {
		throw new Error(
			`Cannot apply bulk entry to distribution log ${log._id} (status: '${log.status}')`
		);
	}
	const qty = positiveWholeQtySchema.parse(ref.qty);
	const nextReturned = addQty(log.qty_returned ?? '0', qty);
	if (qtyGt(nextReturned, log.qty)) {
		throw new Error(`Bulk entry qty ${qty} exceeds outstanding qty on ${log._id}`);
	}
	const next = distributionLogDocSchema.parse({
		...log,
		schema_v: DISTRIBUTION_LOG_SCHEMA_V,
		status: parseQty(nextReturned).eq(log.qty) ? 'returned' : 'partially_returned',
		qty_returned: nextReturned,
		clear_reason: 'bulk_dropoff',
		applied_bulk_entry_ids: [...applied, ref.entry_id],
		returned_at: at,
		returned_by: actor,
		updated_at: at
	}) as DistributionLog;
	assertDistributionLogIssuanceImmutable(log, next);
	return next;
}

/**
 * Pure v3 bulk REVERT (entry void): removes one applied entry from a loan. Idempotent — when
 * `entry_id` is not in applied_bulk_entry_ids the log is returned unchanged. Throws when the loan
 * is not partially_returned|returned or `qty` exceeds qty_returned. Status becomes `active` (with
 * qty_returned '0', clear_reason/returned_* left set) when nothing remains returned, otherwise
 * `partially_returned`. Upgrades schema_v to 2; never writes bulk_pool_id.
 */
export function revertBulkEntryFromLog(
	log: DistributionLog,
	ref: BulkEntryRef,
	actor: string,
	at: string
): DistributionLog {
	const applied = log.applied_bulk_entry_ids ?? [];
	if (!applied.includes(ref.entry_id)) return log;
	if (!['partially_returned', 'returned'].includes(log.status)) {
		throw new Error(
			`Cannot revert bulk entry from distribution log ${log._id} (status: '${log.status}')`
		);
	}
	const qty = positiveWholeQtySchema.parse(ref.qty);
	const returned = log.qty_returned ?? '0';
	if (qtyGt(qty, returned)) {
		throw new Error(`Bulk entry qty ${qty} exceeds qty_returned on ${log._id}`);
	}
	const nextReturned = subQty(returned, qty);
	const next = distributionLogDocSchema.parse({
		...log,
		schema_v: DISTRIBUTION_LOG_SCHEMA_V,
		status: qtyIsZero(nextReturned) ? 'active' : 'partially_returned',
		qty_returned: nextReturned,
		clear_reason: 'bulk_dropoff',
		applied_bulk_entry_ids: applied.filter((id) => id !== ref.entry_id),
		returned_at: at,
		returned_by: actor,
		updated_at: at
	}) as DistributionLog;
	assertDistributionLogIssuanceImmutable(log, next);
	return next;
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
