import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import { bulkReturnEntryIdSchema, type BulkReturnEntry } from './bulk-return-entry';
import { canAppendToPool, type BulkReturnPoolV3 } from './bulk-return-pool-v3';
import {
	bulkReturnPoolIdSchema,
	foodSuppliesBaseDocShape,
	positiveWholeQtySchema,
	ULID_PATTERN
} from './shared';

/**
 * #658 — `bulk_return_entry_void`: an append-only reversal of one `bulk_return_entry`.
 * `_id` is `bulk_return_entry_void:{entryULID}`, so an entry can be voided at most once (a second
 * attempt collides, 409). Voider/time are the envelope's `created_by` / `created_at`.
 * `pool_id` is the pool the entry resolves to at void time; item_id/qty are copied from the entry so
 * the `_sum` view needs no join. validate_doc_update cannot check that `pool_id` is the entry's
 * current pool or that the pool is still OPEN — advisory: `canVoidEntry` + the fold
 * (`resolveBulkReturnEntries`). The loan side (reverting each loan_ref on the distribution_log) is
 * done by the application layer with `revertBulkEntryFromLog`.
 */

export const BULK_RETURN_ENTRY_VOID_SCHEMA_V = 1;

const voidIdRe = new RegExp(`^bulk_return_entry_void:(${ULID_PATTERN})$`);

export const bulkReturnEntryVoidIdSchema = z.string().regex(voidIdRe);

/** `bulk_return_entry_void:{entryULID}` for an entry id. */
export function deriveEntryVoidId(entryId: string): string {
	const match = entryId.match(new RegExp(`^bulk_return_entry:(${ULID_PATTERN})$`));
	if (!match) throw new Error(`Invalid bulk_return_entry ID format: ${entryId}`);
	return `bulk_return_entry_void:${match[1]}`;
}

const bulkReturnEntryVoidFields = {
	entry_id: bulkReturnEntryIdSchema,
	pool_id: bulkReturnPoolIdSchema,
	item_id: z.string().min(1),
	qty: positiveWholeQtySchema,
	notes: z.string().trim().min(1).optional()
};

export const bulkReturnEntryVoidDocSchema = z
	.object({
		_id: bulkReturnEntryVoidIdSchema,
		type: z.literal('bulk_return_entry_void'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_ENTRY_VOID_SCHEMA_V),
		...bulkReturnEntryVoidFields
	})
	.superRefine((doc, ctx) => {
		const match = doc._id.match(voidIdRe);
		if (match && `bulk_return_entry:${match[1]}` !== doc.entry_id) {
			ctx.addIssue({
				code: 'custom',
				path: ['entry_id'],
				message: 'entry_id must match the entry ULID in _id'
			});
		}
	});
export type BulkReturnEntryVoid = BaseDoc & z.infer<typeof bulkReturnEntryVoidDocSchema>;

export const bulkReturnEntryVoidInputSchema = z.object({
	entry: z.custom<BulkReturnEntry>(),
	pool_id: bulkReturnPoolIdSchema,
	notes: bulkReturnEntryVoidFields.notes
});
export type BulkReturnEntryVoidInput = z.input<typeof bulkReturnEntryVoidInputSchema>;

/** Creates the void of `entry` (resolved into `pool_id`), copying item_id/qty from it. */
export function createBulkReturnEntryVoid(
	input: BulkReturnEntryVoidInput,
	ctx: AuthorContext
): BulkReturnEntryVoid {
	const { entry, pool_id, notes } = bulkReturnEntryVoidInputSchema.parse(input);
	return bulkReturnEntryVoidDocSchema.parse(
		makeDoc(
			'bulk_return_entry_void',
			BULK_RETURN_ENTRY_VOID_SCHEMA_V,
			{
				entry_id: entry._id,
				pool_id,
				item_id: entry.item_id,
				qty: entry.qty,
				...(notes ? { notes } : {})
			},
			ctx,
			deriveEntryVoidId(entry._id)
		)
	) as BulkReturnEntryVoid;
}

/** Advisory fence: an entry can only be voided while its pool is OPEN and unlocked. */
export function canVoidEntry(pool: Pick<BulkReturnPoolV3, 'status' | 'lock'>): boolean {
	return canAppendToPool(pool);
}
