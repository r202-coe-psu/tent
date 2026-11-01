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

/** Who dropped the item off. `unspecified` is the canonical encoding of "not recorded". */
export const bulkReturnEntryReturnerTypeSchema = z.enum(['evacuee', 'volunteer', 'unspecified']);
export type BulkReturnEntryReturnerType = z.infer<typeof bulkReturnEntryReturnerTypeSchema>;

/** A concrete returner id is an `evacuee:` or `volunteer:` id. */
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
	returner_type: bulkReturnEntryReturnerTypeSchema,
	// Required key: null for `unspecified`, otherwise an id matching returner_type.
	returner_id: bulkReturnEntryReturnerIdSchema.nullable(),
	loan_refs: z.array(bulkReturnEntryLoanRefSchema),
	notes: z.string().trim().min(1).optional()
};

function validateBulkReturnEntry(
	entry: z.infer<z.ZodObject<typeof bulkReturnEntryFields>>,
	ctx: z.RefinementCtx
): void {
	if (entry.returner_type === 'unspecified') {
		if (entry.returner_id !== null) {
			ctx.addIssue({
				code: 'custom',
				path: ['returner_id'],
				message: 'unspecified returner_type requires returner_id null'
			});
		}
		if (entry.loan_refs.length > 0) {
			ctx.addIssue({
				code: 'custom',
				path: ['loan_refs'],
				message: 'unspecified returner_type requires empty loan_refs'
			});
		}
	} else if (
		entry.returner_id === null ||
		!entry.returner_id.startsWith(`${entry.returner_type}:`)
	) {
		ctx.addIssue({
			code: 'custom',
			path: ['returner_id'],
			message: `${entry.returner_type} returner_type requires a ${entry.returner_type}: returner_id`
		});
	}

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
	// Loan refs may cover only part of the drop-off (a returner with no outstanding loan has none).
	if (!qtyLte(sum, entry.qty)) {
		ctx.addIssue({
			code: 'custom',
			path: ['loan_refs'],
			message: 'sum of loan_refs qty must not exceed entry qty'
		});
	}
}

/**
 * Whether a catalog item may be dropped into a bulk return pool: only items the catalog marks
 * `returnable: true`. `type_class` is ignored (catalog `returnable` is the single source of truth,
 * as for `distribution_log.is_returnable`), and deactivated items stay eligible so loans of items
 * deactivated after lending can still be returned. Not enforced here — the add-entry workflow
 * (#659) looks the item up in the catalog and rejects before writing.
 */
export function isBulkReturnEligibleItem(item: { returnable?: boolean }): boolean {
	return item.returnable === true;
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
	returner_type: bulkReturnEntryReturnerTypeSchema,
	// Optional at the input boundary: the factory writes null for `unspecified`.
	returner_id: bulkReturnEntryFields.returner_id.optional(),
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
	const body = {
		...parsed,
		returner_id: parsed.returner_id ?? (parsed.returner_type === 'unspecified' ? null : undefined)
	};
	return bulkReturnEntryDocSchema.parse(
		makeDoc('bulk_return_entry', BULK_RETURN_ENTRY_SCHEMA_V, body, ctx, operationUlid)
	) as BulkReturnEntry;
}
