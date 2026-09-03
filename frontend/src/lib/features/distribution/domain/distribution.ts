import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc, now } from '$lib/db/model';
import {
	addQty,
	parseQty,
	persistQty,
	qtyGt,
	qtyIsZero,
	subQty,
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
export const distributionIssueIdSchema = z
	.string()
	.regex(/^distribution_issue:[0-9A-HJKMNP-TV-Z]{26}$/);

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

/**
 * Pure derived allocation outcome for presentation and summary.
 * It is NOT persisted on DistributionRequest.
 */
export const approvalCoverageSchema = z.enum(['full', 'partial']);
export type ApprovalCoverage = z.infer<typeof approvalCoverageSchema>;

export const distributionRequestItemSchema = z.object({
	item_id: z.string().min(1),
	requested_qty: qtyStrCoercePositiveSchema,
	unit: z.string().trim().min(1),
	distribution_type_snapshot: distributionTypeSnapshotSchema,
	target_qty_snapshot: qtyStrCoerceNonNegativeSchema
});
export type DistributionRequestItem = z.infer<typeof distributionRequestItemSchema>;

/**
 * Enforces that duplicate request item rows sharing the same item_id have identical
 * unit and distribution_type_snapshot metadata, guaranteeing safe aggregation and
 * preserving Phase 3B item-level authority.
 */
export function validateRequestItemsDuplicateCompatibility(
	items: readonly Pick<DistributionRequestItem, 'item_id' | 'unit' | 'distribution_type_snapshot'>[]
): { isValid: boolean; error?: string } {
	const metaMap = new Map<string, { unit: string; type: string }>();
	for (const item of items) {
		const existing = metaMap.get(item.item_id);
		if (!existing) {
			metaMap.set(item.item_id, {
				unit: item.unit,
				type: item.distribution_type_snapshot
			});
		} else {
			if (existing.unit !== item.unit) {
				return {
					isValid: false,
					error: `Duplicate request item ${item.item_id} has conflicting units: "${existing.unit}" vs "${item.unit}"`
				};
			}
			if (existing.type !== item.distribution_type_snapshot) {
				return {
					isValid: false,
					error: `Duplicate request item ${item.item_id} has conflicting distribution types: "${existing.type}" vs "${item.distribution_type_snapshot}"`
				};
			}
		}
	}
	return { isValid: true };
}

export const distributionRequestInputSchema = z
	.object({
		purpose: z.string().trim().min(1),
		note: z.string().trim().min(1).optional(),
		requested_at: z.string().datetime().optional(),
		active_headcount_snapshot: activeHeadcountSchema,
		buffer_percent: bufferPercentSchema,
		items: z.array(distributionRequestItemSchema).min(1)
	})
	.superRefine((data, ctx) => {
		const seenItemIds = new Set<string>();
		for (const [index, item] of data.items.entries()) {
			if (seenItemIds.has(item.item_id)) {
				ctx.addIssue({
					code: 'custom',
					path: ['items', index, 'item_id'],
					message: 'A new distribution request cannot contain duplicate item_id values'
				});
			} else {
				seenItemIds.add(item.item_id);
			}
		}

		const validation = validateRequestItemsDuplicateCompatibility(data.items);
		if (!validation.isValid) {
			ctx.addIssue({
				code: 'custom',
				path: ['items'],
				message: validation.error
			});
		}
	});
export type DistributionRequestInput = z.input<typeof distributionRequestInputSchema>;

export const distributionRequestDocSchema = z
	.object({
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
	})
	.superRefine((data, ctx) => {
		const validation = validateRequestItemsDuplicateCompatibility(data.items);
		if (!validation.isValid) {
			ctx.addIssue({
				code: 'custom',
				path: ['items'],
				message: validation.error
			});
		}
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

/**
 * Calculates the terminal coverage outcome from request quantities and the
 * canonical allocation plan. Request rows may repeat an item_id; allocations
 * are canonically identified by item_id + lot_ref, so quantities are summed by
 * item_id without discarding any request row.
 */
export function calculateApprovalCoverage(
	requestItems: readonly Pick<DistributionRequestItem, 'item_id' | 'requested_qty'>[],
	allocations: readonly { item_id: string; qty: string | number }[]
): ApprovalCoverage {
	const requestedByItem = new Map<string, string>();
	for (const item of requestItems) {
		requestedByItem.set(
			item.item_id,
			addQty(requestedByItem.get(item.item_id) ?? '0', item.requested_qty)
		);
	}

	const allocatedByItem = new Map<string, string>();
	let hasPositiveAllocation = false;
	for (const allocation of allocations) {
		if (!requestedByItem.has(allocation.item_id)) {
			throw new Error(`Allocation item ${allocation.item_id} is not requested`);
		}
		if (!qtyGt(allocation.qty, 0)) {
			throw new Error('Approval coverage requires a positive allocation');
		}
		hasPositiveAllocation = true;
		allocatedByItem.set(
			allocation.item_id,
			addQty(allocatedByItem.get(allocation.item_id) ?? '0', allocation.qty)
		);
	}

	if (!hasPositiveAllocation) {
		throw new Error('Approval coverage requires at least one positive allocation');
	}

	for (const [itemId, requestedQty] of requestedByItem) {
		const allocatedQty = allocatedByItem.get(itemId) ?? '0';
		if (qtyGt(allocatedQty, requestedQty)) {
			throw new Error(`Allocation for ${itemId} exceeds requested quantity`);
		}
		if (!qtyIsZero(subQty(requestedQty, allocatedQty))) {
			return 'partial';
		}
	}

	return 'full';
}

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
	_id: distributionIssueIdSchema,
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
	item_id: z.string().min(1),
	lot_ref: stockLedgerIdSchema,
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

export function isDistributionIssue(doc: unknown): doc is DistributionIssue {
	return (
		typeof doc === 'object' &&
		doc !== null &&
		(doc as DistributionIssue).type === 'distribution_issue' &&
		typeof (doc as DistributionIssue)._id === 'string' &&
		(doc as DistributionIssue)._id.startsWith('distribution_issue:')
	);
}

export const distributionIssueIdempotencyInputSchema = z.object({
	batch_id: distributionBatchIdSchema,
	idempotency_key: z.string().trim().min(1),
	issue_id: distributionIssueIdSchema,
	evacuee_id: z.string().regex(/^evacuee:.+/),
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	repeat_override_reason: repeatOverrideReasonSchema.optional(),
	repeat_override_note: z.string().trim().min(1).optional()
});
export type DistributionIssueIdempotencyInput = z.input<
	typeof distributionIssueIdempotencyInputSchema
>;

export const distributionIssueIdempotencyDocSchema = z.object({
	_id: z.string().regex(/^distribution_issue_idempotency:[0-9a-f]{64}$/),
	type: z.literal('distribution_issue_idempotency'),
	...baseDocShape,
	batch_id: distributionBatchIdSchema,
	idempotency_key: z.string().trim().min(1),
	issue_id: distributionIssueIdSchema,
	evacuee_id: z.string().regex(/^evacuee:.+/),
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	repeat_override_reason: repeatOverrideReasonSchema.optional(),
	repeat_override_note: z.string().trim().min(1).optional()
});
export type DistributionIssueIdempotency = BaseDoc &
	z.infer<typeof distributionIssueIdempotencyDocSchema>;

export function createDistributionIssueIdempotency(
	input: DistributionIssueIdempotencyInput,
	hash: string,
	ctx: AuthorContext
): DistributionIssueIdempotency {
	const parsed = distributionIssueIdempotencyInputSchema.parse(input);
	if (!hash.trim()) throw new Error('hash is required');
	return distributionIssueIdempotencyDocSchema.parse(
		makeDoc('distribution_issue_idempotency', 1, parsed, ctx, hash)
	) as DistributionIssueIdempotency;
}

export const issueCapacityPendingClaimSchema = z.object({
	operation_id: z.string().min(1),
	issue_id: distributionIssueIdSchema,
	batch_id: distributionBatchIdSchema,
	item_id: z.string().min(1),
	qty: qtyStrCoercePositiveSchema,
	claimed_at: z.string().datetime()
});
export type IssueCapacityPendingClaim = z.infer<typeof issueCapacityPendingClaimSchema>;

export const distributionIssueCapacityInputSchema = z.object({
	batch_id: distributionBatchIdSchema,
	item_id: z.string().min(1),
	pending_claims: z.array(issueCapacityPendingClaimSchema).default([])
});
export type DistributionIssueCapacityInput = z.input<typeof distributionIssueCapacityInputSchema>;

export const distributionIssueCapacityDocSchema = z.object({
	_id: z.string().regex(/^distribution_issue_capacity:[0-9a-f]{64}$/),
	type: z.literal('distribution_issue_capacity'),
	...baseDocShape,
	batch_id: distributionBatchIdSchema,
	item_id: z.string().min(1),
	pending_claims: z.array(issueCapacityPendingClaimSchema)
});
export type DistributionIssueCapacity = BaseDoc &
	z.infer<typeof distributionIssueCapacityDocSchema>;

export function createDistributionIssueCapacity(
	input: DistributionIssueCapacityInput,
	hash: string,
	ctx: AuthorContext
): DistributionIssueCapacity {
	const parsed = distributionIssueCapacityInputSchema.parse(input);
	if (!hash.trim()) throw new Error('hash is required');
	return distributionIssueCapacityDocSchema.parse(
		makeDoc('distribution_issue_capacity', 1, parsed, ctx, hash)
	) as DistributionIssueCapacity;
}

export const oneTimeGuardPendingClaimSchema = z.object({
	operation_id: z.string().min(1),
	issue_id: distributionIssueIdSchema,
	evacuee_id: z.string().regex(/^evacuee:.+/),
	item_id: z.string().min(1),
	claimed_at: z.string().datetime()
});
export type OneTimeGuardPendingClaim = z.infer<typeof oneTimeGuardPendingClaimSchema>;

export const distributionOneTimeGuardInputSchema = z.object({
	evacuee_id: z.string().regex(/^evacuee:.+/),
	item_id: z.string().min(1),
	pending_claims: z.array(oneTimeGuardPendingClaimSchema).default([])
});
export type DistributionOneTimeGuardInput = z.input<typeof distributionOneTimeGuardInputSchema>;

export const distributionOneTimeGuardDocSchema = z.object({
	_id: z.string().regex(/^distribution_one_time_guard:[0-9a-f]{64}$/),
	type: z.literal('distribution_one_time_guard'),
	...baseDocShape,
	evacuee_id: z.string().regex(/^evacuee:.+/),
	item_id: z.string().min(1),
	pending_claims: z.array(oneTimeGuardPendingClaimSchema).max(1)
});
export type DistributionOneTimeGuard = BaseDoc & z.infer<typeof distributionOneTimeGuardDocSchema>;

export function createDistributionOneTimeGuard(
	input: DistributionOneTimeGuardInput,
	hash: string,
	ctx: AuthorContext
): DistributionOneTimeGuard {
	const parsed = distributionOneTimeGuardInputSchema.parse(input);
	if (!hash.trim()) throw new Error('hash is required');
	return distributionOneTimeGuardDocSchema.parse(
		makeDoc('distribution_one_time_guard', 1, parsed, ctx, hash)
	) as DistributionOneTimeGuard;
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
