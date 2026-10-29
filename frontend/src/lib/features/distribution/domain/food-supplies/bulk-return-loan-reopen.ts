import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { bulkReturnEntryIdSchema, type BulkReturnEntry } from './bulk-return-entry';
import type { BulkReturnPoolV3 } from './bulk-return-pool-v3';
import {
	bulkReturnPoolIdSchema,
	distributionLogIdSchema,
	foodSuppliesBaseDocShape,
	ULID_PATTERN
} from './shared';

/**
 * CR-193 §35 — `bulk_return_loan_reopen`: an append-only record that the loan side of ONE
 * `bulk_return_entry` of a closed (SUBMITTED / RECEIVED) pool was deliberately reopened. `_id` is
 * `bulk_return_loan_reopen:{entryULID}`, so an entry is reopened at most once (a second attempt
 * collides, 409). Who/when are the envelope's `created_by` / `created_at`. It touches neither the
 * pool snapshot, the entry nor stock: only the loans (`loan_ids`, the loans that held a ref of the
 * entry) are reverted by the application layer. The "cut the missed loans" repair must skip an
 * entry that has this doc, otherwise it would re-cut what was reopened on purpose.
 */

export const BULK_RETURN_LOAN_REOPEN_SCHEMA_V = 1;

const reopenIdRe = new RegExp(`^bulk_return_loan_reopen:(${ULID_PATTERN})$`);

export const bulkReturnLoanReopenIdSchema = z.string().regex(reopenIdRe);

/** `bulk_return_loan_reopen:{entryULID}` for an entry id. */
export function deriveLoanReopenId(entryId: string): string {
	const match = entryId.match(new RegExp(`^bulk_return_entry:(${ULID_PATTERN})$`));
	if (!match) throw new Error(`Invalid bulk_return_entry ID format: ${entryId}`);
	return `bulk_return_loan_reopen:${match[1]}`;
}

export const BULK_RETURN_LOAN_REOPEN_REASON_MAX = 500;

const reasonSchema = z.string().trim().min(1).max(BULK_RETURN_LOAN_REOPEN_REASON_MAX);

const loanIdsSchema = z
	.array(distributionLogIdSchema)
	.min(1)
	.refine((ids) => new Set(ids).size === ids.length, { message: 'loan_ids must be unique' });

const bulkReturnLoanReopenFields = {
	entry_id: bulkReturnEntryIdSchema,
	pool_id: bulkReturnPoolIdSchema,
	reason: reasonSchema,
	loan_ids: loanIdsSchema
};

export const bulkReturnLoanReopenDocSchema = z
	.object({
		_id: bulkReturnLoanReopenIdSchema,
		type: z.literal('bulk_return_loan_reopen'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_LOAN_REOPEN_SCHEMA_V),
		...bulkReturnLoanReopenFields
	})
	.superRefine((doc, ctx) => {
		const match = doc._id.match(reopenIdRe);
		if (match && `bulk_return_entry:${match[1]}` !== doc.entry_id) {
			ctx.addIssue({
				code: 'custom',
				path: ['entry_id'],
				message: 'entry_id must match the entry ULID in _id'
			});
		}
	});
export type BulkReturnLoanReopen = BaseDoc & z.infer<typeof bulkReturnLoanReopenDocSchema>;

export const bulkReturnLoanReopenInputSchema = z.object({
	entry: z.custom<BulkReturnEntry>(),
	pool_id: bulkReturnPoolIdSchema,
	reason: reasonSchema,
	loan_ids: loanIdsSchema
});
export type BulkReturnLoanReopenInput = z.input<typeof bulkReturnLoanReopenInputSchema>;

/** Creates the loan reopen of `entry` (in closed pool `pool_id`) for the loans in `loan_ids`. */
export function createBulkReturnLoanReopen(
	input: BulkReturnLoanReopenInput,
	ctx: AuthorContext
): BulkReturnLoanReopen {
	const { entry, pool_id, reason, loan_ids } = bulkReturnLoanReopenInputSchema.parse(input);
	return bulkReturnLoanReopenDocSchema.parse(
		makeDoc(
			'bulk_return_loan_reopen',
			BULK_RETURN_LOAN_REOPEN_SCHEMA_V,
			{ entry_id: entry._id, pool_id, reason, loan_ids },
			ctx,
			deriveLoanReopenId(entry._id)
		)
	) as BulkReturnLoanReopen;
}

/**
 * Advisory fence: the loans of an entry can only be reopened while its pool is closed
 * (SUBMITTED / RECEIVED) and its snapshot (`entry_ids`) counted the entry. An OPEN pool voids the
 * entry instead; a CANCELLED pool has no entries.
 */
export function canReopenEntryLoans(
	pool: Pick<BulkReturnPoolV3, 'status' | 'entry_ids'>,
	entryId: string
): boolean {
	if (pool.status !== 'SUBMITTED' && pool.status !== 'RECEIVED') return false;
	return (pool.entry_ids ?? []).includes(entryId);
}
