import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { parseQty, qtyGt } from '$lib/utils/qty';
import {
	bulkReturnPoolIdSchema,
	foodSuppliesBaseDocShape,
	requisitionTicketIdSchema,
	stockLedgerIdSchema,
	positiveWholeQtySchema,
	nonNegativeWholeQtySchema,
	positiveWholeQtyCoerceSchema,
	ULID_PATTERN
} from './shared';

export const bulkReturnPoolStatusSchema = z.enum(['ACTIVE', 'EXHAUSTED', 'CLOSED']);
export type BulkReturnPoolStatus = z.infer<typeof bulkReturnPoolStatusSchema>;

export const bulkReturnClaimIdPattern = new RegExp(`^bulk_return_claim:${ULID_PATTERN}$`);

const bulkReturnPoolFields = {
	item_id: z.string().min(1),
	stock_ledger_id: stockLedgerIdSchema,
	ticket_id: requisitionTicketIdSchema.optional(),
	shift_id: z.string().min(1).optional(),
	total_received_qty: positiveWholeQtySchema,
	claimed_qty: nonNegativeWholeQtySchema,
	unclaimed_quota: nonNegativeWholeQtySchema,
	claim_ids: z.array(z.string().regex(bulkReturnClaimIdPattern)).default([]),
	status: bulkReturnPoolStatusSchema,
	closed_at: z.string().datetime().optional(),
	closed_by: z.string().min(1).optional(),
	notes: z.string().trim().min(1).optional()
};

function validateBulkReturnPool(
	pool: z.infer<z.ZodObject<typeof bulkReturnPoolFields>> & { schema_v: number },
	ctx: z.RefinementCtx
): void {
	if (!parseQty(pool.claimed_qty).plus(pool.unclaimed_quota).eq(pool.total_received_qty)) {
		ctx.addIssue({
			code: 'custom',
			path: ['unclaimed_quota'],
			message: 'claimed_qty + unclaimed_quota must equal total_received_qty'
		});
	}
	if (pool.status === 'ACTIVE' && !qtyGt(pool.unclaimed_quota, 0)) {
		ctx.addIssue({
			code: 'custom',
			path: ['status'],
			message: 'ACTIVE pool must have remaining quota'
		});
	}
	if (pool.status === 'EXHAUSTED' && !parseQty(pool.unclaimed_quota).isZero()) {
		ctx.addIssue({
			code: 'custom',
			path: ['status'],
			message: 'EXHAUSTED pool must have zero quota'
		});
	}
	if (pool.status === 'CLOSED' && (!pool.closed_at || !pool.closed_by)) {
		ctx.addIssue({
			code: 'custom',
			path: ['closed_at'],
			message: 'CLOSED pool requires close audit fields'
		});
	}
	if (pool.claim_ids && new Set(pool.claim_ids).size !== pool.claim_ids.length) {
		ctx.addIssue({
			code: 'custom',
			path: ['claim_ids'],
			message: 'claim_ids must not contain duplicate claim IDs'
		});
	}
}

export const bulkReturnPoolDocSchema = z
	.object({
		_id: bulkReturnPoolIdSchema,
		type: z.literal('bulk_return_pool'),
		...foodSuppliesBaseDocShape,
		schema_v: z.union([z.literal(1), z.literal(2)]),
		...bulkReturnPoolFields
	})
	.superRefine(validateBulkReturnPool);
export type BulkReturnPool = BaseDoc & z.infer<typeof bulkReturnPoolDocSchema>;

export const bulkReturnPoolInputSchema = z.object({
	item_id: z.string().min(1),
	stock_ledger_id: stockLedgerIdSchema,
	ticket_id: requisitionTicketIdSchema.optional(),
	shift_id: z.string().min(1).optional(),
	total_received_qty: positiveWholeQtyCoerceSchema,
	notes: z.string().trim().min(1).optional()
});
export type BulkReturnPoolInput = z.input<typeof bulkReturnPoolInputSchema>;

export function createBulkReturnPool(
	input: BulkReturnPoolInput,
	ctx: AuthorContext,
	id?: string
): BulkReturnPool {
	const parsed = bulkReturnPoolInputSchema.parse(input);
	return bulkReturnPoolDocSchema.parse(
		makeDoc(
			'bulk_return_pool',
			2,
			{
				...parsed,
				claimed_qty: '0',
				unclaimed_quota: parsed.total_received_qty,
				claim_ids: [],
				status: 'ACTIVE' as const
			},
			ctx,
			id
		)
	) as BulkReturnPool;
}
