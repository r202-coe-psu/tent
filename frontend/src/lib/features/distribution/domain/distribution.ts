import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc, now } from '$lib/db/model';
import {
	parseQty,
	persistQty,
	qtyStrCoerceNonNegativeSchema,
	qtyStrCoercePositiveSchema
} from '$lib/utils/qty';
import {
	distributionTypeSnapshotSchema,
	eligibilitySnapshotSchema,
	repeatOverrideReasonSchema
} from './eligibility';
import { reconciliationRowSchema } from './reconciliation';

const REQUEST_PREFIX = 'distribution_request:';

const distributionRequestIdSchema = z.string().regex(/^distribution_request:.+/);
const distributionBatchIdSchema = z.string().regex(/^distribution_batch:.+/);
const stockLedgerIdSchema = z.string().regex(/^stock_ledger:.+/);

const baseDocShape = {
	_rev: z.string().optional(),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	created_at: z.string().datetime(),
	updated_at: z.string().datetime(),
	created_by: z.string().min(1)
};

export const bufferPercentSchema = z.coerce.number().int().min(5).max(10).default(10);

export const activeHeadcountSchema = qtyStrCoerceNonNegativeSchema.refine(
	(value) => parseQty(value).isInteger(),
	'Active headcount must be an integer'
);

export const distributionRequestStatusSchema = z.enum([
	'pending',
	'approving',
	'approved',
	'rejected',
	'cancelled'
]);
export type DistributionRequestStatus = z.infer<typeof distributionRequestStatusSchema>;

export const distributionRequestItemSchema = z.object({
	item_id: z.string().min(1),
	requested_qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1),
	distribution_type_snapshot: distributionTypeSnapshotSchema,
	target_qty_snapshot: qtyStrCoerceNonNegativeSchema
});
export type DistributionRequestItem = z.infer<typeof distributionRequestItemSchema>;

export const distributionRequestInputSchema = z.object({
	purpose: z.string().trim().min(1),
	note: z.string().trim().min(1).optional(),
	requested_at: z.string().datetime().optional(),
	active_headcount_snapshot: activeHeadcountSchema,
	buffer_percent: bufferPercentSchema,
	items: z.array(distributionRequestItemSchema).min(1)
});
export type DistributionRequestInput = z.input<typeof distributionRequestInputSchema>;

export const distributionRequestDocSchema = z.object({
	_id: distributionRequestIdSchema,
	type: z.literal('distribution_request'),
	...baseDocShape,
	status: distributionRequestStatusSchema,
	requested_by: z.string().min(1),
	requested_at: z.string().datetime(),
	purpose: z.string().trim().min(1),
	note: z.string().trim().min(1).optional(),
	active_headcount_snapshot: activeHeadcountSchema,
	buffer_percent: bufferPercentSchema,
	items: z.array(distributionRequestItemSchema).min(1),
	approval_operation_id: z.string().min(1).optional(),
	approved_by: z.string().min(1).optional(),
	approved_at: z.string().datetime().optional(),
	rejected_by: z.string().min(1).optional(),
	rejected_at: z.string().datetime().optional(),
	rejection_reason: z.string().trim().min(1).optional(),
	batch_id: distributionBatchIdSchema.optional()
});
export type DistributionRequest = BaseDoc & z.infer<typeof distributionRequestDocSchema>;

const REQUEST_TRANSITIONS: Record<DistributionRequestStatus, DistributionRequestStatus[]> = {
	pending: ['approving', 'rejected', 'cancelled'],
	approving: ['approved', 'pending'],
	approved: [],
	rejected: [],
	cancelled: []
};

export function canTransitionDistributionRequest(
	from: DistributionRequestStatus,
	to: DistributionRequestStatus
): boolean {
	return REQUEST_TRANSITIONS[from].includes(to);
}

export function canEditDistributionRequest(status: DistributionRequestStatus): boolean {
	return status === 'pending';
}

export function createDistributionRequest(
	input: DistributionRequestInput,
	ctx: AuthorContext,
	id?: string
): DistributionRequest {
	const parsed = distributionRequestInputSchema.parse(input);
	return distributionRequestDocSchema.parse(
		makeDoc(
			'distribution_request',
			1,
			{
				status: 'pending' as const,
				requested_by: ctx.createdBy,
				requested_at: parsed.requested_at ?? now(),
				purpose: parsed.purpose,
				...(parsed.note ? { note: parsed.note } : {}),
				active_headcount_snapshot: parsed.active_headcount_snapshot,
				buffer_percent: parsed.buffer_percent,
				items: parsed.items
			},
			ctx,
			id
		)
	) as DistributionRequest;
}

export const distributionBatchStatusSchema = z.enum(['activating', 'active', 'closing', 'closed']);
export type DistributionBatchStatus = z.infer<typeof distributionBatchStatusSchema>;

export const distributionBatchItemSchema = z.object({
	item_id: z.string().min(1),
	allocated_qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1),
	distribution_type_snapshot: distributionTypeSnapshotSchema
});
export type DistributionBatchItem = z.infer<typeof distributionBatchItemSchema>;

export const distributionLotSnapshotSchema = z.object({
	expiry: z.string().optional(),
	note: z.string().trim().optional(),
	lot_no: z.string().optional(),
	storage_zone: z.string().trim().max(100).optional()
});

export const distributionAllocationSchema = z.object({
	item_id: z.string().min(1),
	lot_ref: stockLedgerIdSchema,
	lot: distributionLotSnapshotSchema,
	qty: qtyStrCoercePositiveSchema,
	allocation_ledger_id: stockLedgerIdSchema
});
export type DistributionAllocation = z.infer<typeof distributionAllocationSchema>;

export const distributionBatchInputSchema = z.object({
	request_id: distributionRequestIdSchema,
	activated_at: z.string().datetime().optional(),
	items: z.array(distributionBatchItemSchema).min(1),
	allocations: z.array(distributionAllocationSchema).min(1),
	reconciliation: z.array(reconciliationRowSchema).default([]),
	return_ledger_ids: z.array(stockLedgerIdSchema).default([])
});
export type DistributionBatchInput = z.input<typeof distributionBatchInputSchema>;

export const distributionBatchDocSchema = z
	.object({
		_id: distributionBatchIdSchema,
		type: z.literal('distribution_batch'),
		...baseDocShape,
		request_id: distributionRequestIdSchema,
		status: distributionBatchStatusSchema,
		activated_by: z.string().min(1),
		activated_at: z.string().datetime(),
		items: z.array(distributionBatchItemSchema).min(1),
		allocations: z.array(distributionAllocationSchema).min(1),
		closing_operation_id: z.string().min(1).optional(),
		closed_by: z.string().min(1).optional(),
		closed_at: z.string().datetime().optional(),
		reconciliation: z.array(reconciliationRowSchema),
		return_ledger_ids: z.array(stockLedgerIdSchema)
	})
	.refine(
		(batch) => batch._id === `distribution_batch:${batch.request_id.slice(REQUEST_PREFIX.length)}`,
		{ path: ['_id'], message: 'Batch ID must be derived from request_id' }
	);
export type DistributionBatch = BaseDoc & z.infer<typeof distributionBatchDocSchema>;

const BATCH_TRANSITIONS: Record<DistributionBatchStatus, DistributionBatchStatus[]> = {
	activating: ['active'],
	active: ['closing'],
	closing: ['closed'],
	closed: []
};

export function canTransitionDistributionBatch(
	from: DistributionBatchStatus,
	to: DistributionBatchStatus
): boolean {
	return BATCH_TRANSITIONS[from].includes(to);
}

export function createDistributionBatch(
	input: DistributionBatchInput,
	ctx: AuthorContext
): DistributionBatch {
	const parsed = distributionBatchInputSchema.parse(input);
	const requestUlid = parsed.request_id.slice(REQUEST_PREFIX.length);
	return distributionBatchDocSchema.parse(
		makeDoc(
			'distribution_batch',
			1,
			{
				request_id: parsed.request_id,
				status: 'activating' as const,
				activated_by: ctx.createdBy,
				activated_at: parsed.activated_at ?? now(),
				items: parsed.items,
				allocations: parsed.allocations,
				reconciliation: parsed.reconciliation,
				return_ledger_ids: parsed.return_ledger_ids
			},
			ctx,
			requestUlid
		)
	) as DistributionBatch;
}

export const distributionIssueInputSchema = z
	.object({
		batch_id: distributionBatchIdSchema,
		evacuee_id: z.string().regex(/^evacuee:.+/),
		item_id: z.string().min(1),
		qty: qtyStrCoercePositiveSchema,
		unit: z.string().trim().min(1),
		distributed_at: z.string().datetime().optional(),
		distribution_type_snapshot: distributionTypeSnapshotSchema,
		eligibility_snapshot: eligibilitySnapshotSchema,
		repeat_override_reason: repeatOverrideReasonSchema.optional(),
		repeat_override_note: z.string().trim().min(1).optional(),
		idempotency_key: z.string().trim().min(1)
	})
	.superRefine((issue, ctx) => {
		if (!issue.eligibility_snapshot.eligible) {
			ctx.addIssue({
				code: 'custom',
				path: ['eligibility_snapshot'],
				message: 'A rejected eligibility decision cannot be issued'
			});
		}
		if (issue.distribution_type_snapshot !== issue.eligibility_snapshot.distribution_type) {
			ctx.addIssue({
				code: 'custom',
				path: ['distribution_type_snapshot'],
				message: 'Distribution type must match the eligibility snapshot'
			});
		}
		if (issue.repeat_override_reason !== issue.eligibility_snapshot.repeat_override_reason) {
			ctx.addIssue({
				code: 'custom',
				path: ['repeat_override_reason'],
				message: 'Repeat override must match the eligibility snapshot'
			});
		}
	});
export type DistributionIssueInput = z.input<typeof distributionIssueInputSchema>;

export const distributionIssueDocSchema = distributionIssueInputSchema.safeExtend({
	_id: z.string().regex(/^distribution_issue:.+/),
	type: z.literal('distribution_issue'),
	...baseDocShape,
	distributed_at: z.string().datetime(),
	distributed_by: z.string().min(1)
});
export type DistributionIssue = BaseDoc & z.infer<typeof distributionIssueDocSchema>;

export function createDistributionIssue(
	input: DistributionIssueInput,
	ctx: AuthorContext,
	id?: string
): DistributionIssue {
	const parsed = distributionIssueInputSchema.parse(input);
	return distributionIssueDocSchema.parse(
		makeDoc(
			'distribution_issue',
			1,
			{
				...parsed,
				distributed_at: parsed.distributed_at ?? now(),
				distributed_by: ctx.createdBy
			},
			ctx,
			id
		)
	) as DistributionIssue;
}

export const stockLotPendingClaimSchema = z.object({
	operation_id: z.string().min(1),
	request_id: distributionRequestIdSchema,
	batch_id: distributionBatchIdSchema,
	qty: qtyStrCoercePositiveSchema,
	claimed_at: z.string().datetime()
});
export type StockLotPendingClaim = z.infer<typeof stockLotPendingClaimSchema>;

export const stockLotReservationInputSchema = z.object({
	lot_ref: stockLedgerIdSchema,
	pending_claims: z.array(stockLotPendingClaimSchema).default([])
});
export type StockLotReservationInput = z.input<typeof stockLotReservationInputSchema>;

export const stockLotReservationDocSchema = z.object({
	_id: z.string().regex(/^stock_lot_reservation:.+/),
	type: z.literal('stock_lot_reservation'),
	...baseDocShape,
	lot_ref: stockLedgerIdSchema,
	pending_claims: z.array(stockLotPendingClaimSchema)
});
export type StockLotReservation = BaseDoc & z.infer<typeof stockLotReservationDocSchema>;

/** Defines the reservation document only; Phase 3 supplies CouchDB CAS behavior. */
export function createStockLotReservation(
	input: StockLotReservationInput,
	reservationHash: string,
	ctx: AuthorContext
): StockLotReservation {
	const parsed = stockLotReservationInputSchema.parse(input);
	if (!reservationHash.trim()) throw new Error('reservationHash is required');
	return stockLotReservationDocSchema.parse(
		makeDoc('stock_lot_reservation', 1, parsed, ctx, reservationHash)
	) as StockLotReservation;
}

export const nfiTargetInputSchema = z.object({
	active_headcount: activeHeadcountSchema,
	buffer_percent: bufferPercentSchema
});
export type NfiTargetInput = z.input<typeof nfiTargetInputSchema>;

/** `ceil(headcount × (1 + buffer / 100))`, calculated entirely with Decimal. */
export function calculateNfiTarget(input: NfiTargetInput): string {
	const parsed = nfiTargetInputSchema.parse(input);
	const multiplier = parseQty(100).plus(parsed.buffer_percent).dividedBy(100);
	return persistQty(parseQty(parsed.active_headcount).times(multiplier).ceil());
}
