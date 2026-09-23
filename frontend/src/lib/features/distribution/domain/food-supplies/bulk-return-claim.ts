import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { qtyGt, qtyStrPositiveSchema } from '$lib/utils/qty';
import { bulkReturnPoolIdSchema, distributionLogIdSchema, ULID_PATTERN } from './shared';

export const bulkReturnClaimStatusSchema = z.enum([
	'CLAIM_INTENT',
	'POOL_CLAIMED',
	'COMPLETE',
	'ABORTED'
]);
export type BulkReturnClaimStatus = z.infer<typeof bulkReturnClaimStatusSchema>;

export const bulkReturnClaimIdSchema = z
	.string()
	.regex(new RegExp(`^bulk_return_claim:${ULID_PATTERN}$`));

export const operationUlidSchema = z.string().regex(new RegExp(`^${ULID_PATTERN}$`));

export const bulkReturnClaimDocSchema = z.object({
	_id: bulkReturnClaimIdSchema,
	_rev: z.string().optional(),
	type: z.literal('bulk_return_claim'),
	schema_v: z.literal(1),
	shelter_code: z.string().min(1),
	operation_id: operationUlidSchema,
	distribution_log_id: distributionLogIdSchema,
	bulk_pool_id: bulkReturnPoolIdSchema,
	item_id: z.string().min(1),
	claimed_qty: qtyStrPositiveSchema,
	status: bulkReturnClaimStatusSchema,
	created_at: z.string().datetime(),
	created_by: z.string().min(1),
	updated_at: z.string().datetime(),
	notes: z.string().trim().min(1).optional()
});

export type BulkReturnClaim = BaseDoc & z.infer<typeof bulkReturnClaimDocSchema>;

export function deriveClaimIdFromDistributionLog(distributionLogId: string): string {
	const match = distributionLogId.match(new RegExp(`^distribution_log:(${ULID_PATTERN})$`));
	if (!match) {
		throw new Error(`Invalid distribution_log ID format: ${distributionLogId}`);
	}
	return `bulk_return_claim:${match[1]}`;
}

export const createBulkReturnClaimInputSchema = z.object({
	distribution_log_id: distributionLogIdSchema,
	operation_id: operationUlidSchema,
	bulk_pool_id: bulkReturnPoolIdSchema,
	item_id: z.string().min(1),
	claimed_qty: qtyStrPositiveSchema,
	notes: z.string().trim().min(1).optional()
});

export type CreateBulkReturnClaimInput = z.infer<typeof createBulkReturnClaimInputSchema>;

export function createBulkReturnClaim(
	input: CreateBulkReturnClaimInput,
	ctx: AuthorContext
): BulkReturnClaim {
	const parsed = createBulkReturnClaimInputSchema.parse(input);
	if (!qtyGt(parsed.claimed_qty, 0)) {
		throw new Error('claimed_qty must be greater than 0');
	}

	const claimId = deriveClaimIdFromDistributionLog(parsed.distribution_log_id);
	const doc = makeDoc(
		'bulk_return_claim',
		1,
		{
			operation_id: parsed.operation_id,
			distribution_log_id: parsed.distribution_log_id,
			bulk_pool_id: parsed.bulk_pool_id,
			item_id: parsed.item_id,
			claimed_qty: parsed.claimed_qty,
			status: 'CLAIM_INTENT' as const,
			...(parsed.notes ? { notes: parsed.notes } : {})
		},
		ctx,
		claimId.replace('bulk_return_claim:', '')
	);

	return bulkReturnClaimDocSchema.parse(doc) as BulkReturnClaim;
}

/**
 * Asserts permanently immutable fields have not been altered.
 */
export function assertBulkReturnClaimPermanentImmutability(
	existing: BulkReturnClaim,
	next: BulkReturnClaim
): void {
	const immutableFields: (keyof BulkReturnClaim)[] = [
		'_id',
		'type',
		'schema_v',
		'shelter_code',
		'distribution_log_id',
		'item_id',
		'created_at',
		'created_by'
	];

	for (const field of immutableFields) {
		if (existing[field] !== next[field]) {
			throw new Error(`bulk_return_claim.${String(field)} is permanently immutable`);
		}
	}
}

/**
 * Validates allowable state transitions and attempt-scoped field immutability.
 */
export function assertBulkReturnClaimTransition(
	existing: BulkReturnClaim,
	next: BulkReturnClaim
): void {
	assertBulkReturnClaimPermanentImmutability(existing, next);

	const validTransitions: Record<BulkReturnClaimStatus, BulkReturnClaimStatus[]> = {
		CLAIM_INTENT: ['POOL_CLAIMED', 'ABORTED'],
		POOL_CLAIMED: ['COMPLETE'],
		COMPLETE: [],
		ABORTED: ['CLAIM_INTENT']
	};

	const allowed = validTransitions[existing.status] || [];
	if (!allowed.includes(next.status)) {
		throw new Error(
			`Invalid bulk_return_claim transition from ${existing.status} to ${next.status}`
		);
	}

	// Attempt-scoped fields: operation_id, bulk_pool_id, claimed_qty
	// These MUST be identical unless transitioning ABORTED -> CLAIM_INTENT (new attempt)
	const isReinitialization = existing.status === 'ABORTED' && next.status === 'CLAIM_INTENT';
	if (!isReinitialization) {
		if (existing.operation_id !== next.operation_id) {
			throw new Error('bulk_return_claim.operation_id is attempt-scoped immutable');
		}
		if (existing.bulk_pool_id !== next.bulk_pool_id) {
			throw new Error('bulk_return_claim.bulk_pool_id is attempt-scoped immutable');
		}
		if (existing.claimed_qty !== next.claimed_qty) {
			throw new Error('bulk_return_claim.claimed_qty is attempt-scoped immutable');
		}
	} else {
		// In reinitialization, must be a new operation attempt and valid positive qty
		if (!qtyGt(next.claimed_qty, 0)) {
			throw new Error('Reinitialized claim must have claimed_qty > 0');
		}
	}
}
