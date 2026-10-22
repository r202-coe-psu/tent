import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { addQty, qtyLte } from '$lib/utils/qty';
import {
	bulkReturnPoolIdSchema,
	distributionLogIdSchema,
	foodSuppliesBaseDocShape,
	positiveWholeQtySchema,
	positiveWholeQtyCoerceSchema,
	ULID_PATTERN
} from './shared';

/**
 * #658 — `bulk_return_entry`: one append-only drop-off event in a bulk return pool.
 * The doc ULID is the caller's operation ULID, so a retried create is idempotent (409 on replay).
 * `pool_id` is the pool the entry was ORIGINALLY recorded into; later moves are separate
 * `bulk_return_entry_move` docs (resolve the current pool with `resolveEntryPool`).
 * Recorder/time are the envelope's `created_by` / `created_at`.
 */

export const BULK_RETURN_ENTRY_SCHEMA_V = 1;

export const bulkReturnEntryIdSchema = z
	.string()
	.regex(new RegExp(`^bulk_return_entry:${ULID_PATTERN}$`));

export const bulkReturnEntryLoanRefSchema = z.object({
	distribution_log_id: distributionLogIdSchema,
	qty: positiveWholeQtySchema
});
export type BulkReturnEntryLoanRef = z.infer<typeof bulkReturnEntryLoanRefSchema>;

/**
 * Returner is optional: when present it must be an `evacuee:` or `volunteer:` id.
 * TODO(#658 Q5): canonical encoding of an "unspecified" returner — absent and null both accepted.
 */
export const bulkReturnEntryReturnerIdSchema = z
	.string()
	.min(1)
	.refine((v) => v.startsWith('evacuee:') || v.startsWith('volunteer:'), {
		message: 'returner_id must start with evacuee: or volunteer:'
	});

const bulkReturnEntryFields = {
	pool_id: bulkReturnPoolIdSchema,
	item_id: z.string().min(1),
	qty: positiveWholeQtySchema,
	returner_id: bulkReturnEntryReturnerIdSchema.nullable().optional(),
	loan_refs: z.array(bulkReturnEntryLoanRefSchema),
	notes: z.string().trim().min(1).optional()
};

function validateBulkReturnEntry(
	entry: z.infer<z.ZodObject<typeof bulkReturnEntryFields>>,
	ctx: z.RefinementCtx
): void {
	const ids = new Set<string>();
	let sum = '0';
	for (const ref of entry.loan_refs) {
		if (ids.has(ref.distribution_log_id)) {
			ctx.addIssue({
				code: 'custom',
				path: ['loan_refs'],
				message: `loan_refs must not contain duplicate distribution_log_id ${ref.distribution_log_id}`
			});
			return;
		}
		ids.add(ref.distribution_log_id);
		sum = addQty(sum, ref.qty);
	}
	// TODO(#658 Q5): equality vs <= — only the logically necessary <= is enforced.
	if (!qtyLte(sum, entry.qty)) {
		ctx.addIssue({
			code: 'custom',
			path: ['loan_refs'],
			message: 'sum of loan_refs qty must not exceed entry qty'
		});
	}
}

export const bulkReturnEntryDocSchema = z
	.object({
		_id: bulkReturnEntryIdSchema,
		type: z.literal('bulk_return_entry'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_ENTRY_SCHEMA_V),
		...bulkReturnEntryFields
	})
	.superRefine(validateBulkReturnEntry);
export type BulkReturnEntry = BaseDoc & z.infer<typeof bulkReturnEntryDocSchema>;

export const bulkReturnEntryInputSchema = z.object({
	pool_id: bulkReturnPoolIdSchema,
	item_id: z.string().min(1),
	qty: positiveWholeQtyCoerceSchema,
	returner_id: bulkReturnEntryFields.returner_id,
	loan_refs: z.array(bulkReturnEntryLoanRefSchema).default([]),
	notes: bulkReturnEntryFields.notes
});
export type BulkReturnEntryInput = z.input<typeof bulkReturnEntryInputSchema>;

/**
 * Creates an entry. `operationUlid` is required (not minted) so the `_id` is deterministic and
 * retries are idempotent. Write order for the later workflow (#659): entry first, then the
 * distribution_log.
 */
export function createBulkReturnEntry(
	input: BulkReturnEntryInput,
	ctx: AuthorContext,
	operationUlid: string
): BulkReturnEntry {
	const parsed = bulkReturnEntryInputSchema.parse(input);
	return bulkReturnEntryDocSchema.parse(
		makeDoc('bulk_return_entry', BULK_RETURN_ENTRY_SCHEMA_V, parsed, ctx, operationUlid)
	) as BulkReturnEntry;
}
