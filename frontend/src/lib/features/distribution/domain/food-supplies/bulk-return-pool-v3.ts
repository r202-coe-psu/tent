import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import {
	bulkReturnPoolIdSchema,
	foodSuppliesBaseDocShape,
	positiveWholeQtySchema,
	ULID_PATTERN
} from './shared';

/**
 * #658 — bulk return pool, schema_v 3.
 *
 * The pool is a small mutable header. What was dropped into it lives in append-only
 * `bulk_return_entry` / `bulk_return_entry_move` docs (see ./bulk-return-entry*.ts); the
 * `items_summary` snapshot is written once, at submit. Legacy v1/v2 pools (./bulk-return-pool.ts)
 * are frozen and handled elsewhere.
 */

export const BULK_RETURN_POOL_V3_SCHEMA_V = 3;

export const bulkReturnPoolV3StatusSchema = z.enum(['OPEN', 'SUBMITTED', 'RECEIVED']);
export type BulkReturnPoolV3Status = z.infer<typeof bulkReturnPoolV3StatusSchema>;

export const bulkReturnPoolLockOpSchema = z.enum(['SUBMIT', 'DELETE']);

/**
 * Fence on the pool header. Only meaningful while OPEN; must be null/absent once the pool is
 * SUBMITTED/RECEIVED. What a DELETE lock leads to (hard delete vs soft cancel) is undecided.
 * TODO(#658 Q2): deleting a pool — hard delete vs a soft CANCELLED state.
 */
export const bulkReturnPoolLockSchema = z.object({
	op: bulkReturnPoolLockOpSchema,
	op_id: z.string().regex(new RegExp(`^${ULID_PATTERN}$`)),
	locked_at: z.string().datetime(),
	locked_by: z.string().min(1)
});
export type BulkReturnPoolLock = z.infer<typeof bulkReturnPoolLockSchema>;

export const bulkReturnPoolItemSummaryRowSchema = z.object({
	item_id: z.string().min(1),
	qty: positiveWholeQtySchema
});
export type BulkReturnPoolItemSummaryRow = z.infer<typeof bulkReturnPoolItemSummaryRowSchema>;

const bulkReturnPoolV3Fields = {
	// TODO(#658 Q5): no max length / uniqueness on name; no storage-point FK on location.
	name: z.string().trim().min(1),
	location: z.string().trim().min(1).optional(),
	status: bulkReturnPoolV3StatusSchema,
	lock: bulkReturnPoolLockSchema.nullable().optional(),
	// Absent while OPEN; required (possibly empty) once SUBMITTED/RECEIVED; immutable once written.
	// TODO(#658 Q3): whether an empty pool may be submitted is undecided — an empty array is accepted.
	items_summary: z.array(bulkReturnPoolItemSummaryRowSchema).optional(),
	submitted_at: z.string().datetime().optional(),
	submitted_by: z.string().min(1).optional(),
	// TODO(#658 Q4): target of return_ticket_id and CR-121 impact — plain optional non-empty string,
	// no prefix check, no state-based requiredness, no RECEIVED-stage receipt fields.
	return_ticket_id: z.string().min(1).optional(),
	notes: z.string().trim().min(1).optional()
};

function validateBulkReturnPoolV3(
	pool: z.infer<z.ZodObject<typeof bulkReturnPoolV3Fields>>,
	ctx: z.RefinementCtx
): void {
	const issue = (path: string, message: string) =>
		ctx.addIssue({ code: 'custom', path: [path], message });

	if (pool.items_summary) {
		const seen = new Set<string>();
		for (const row of pool.items_summary) {
			if (seen.has(row.item_id)) {
				issue('items_summary', `items_summary must not contain duplicate item_id ${row.item_id}`);
				break;
			}
			seen.add(row.item_id);
		}
	}

	if (pool.status === 'OPEN') {
		if (pool.items_summary !== undefined) {
			issue('items_summary', 'OPEN pool must not have items_summary');
		}
		if (pool.submitted_at !== undefined) {
			issue('submitted_at', 'OPEN pool must not have submitted_at');
		}
		if (pool.submitted_by !== undefined) {
			issue('submitted_by', 'OPEN pool must not have submitted_by');
		}
		return;
	}

	// SUBMITTED | RECEIVED
	if (pool.items_summary === undefined) {
		issue('items_summary', `${pool.status} pool requires items_summary`);
	}
	if (pool.submitted_at === undefined) {
		issue('submitted_at', `${pool.status} pool requires submitted_at`);
	}
	if (pool.submitted_by === undefined) {
		issue('submitted_by', `${pool.status} pool requires submitted_by`);
	}
	if (pool.lock != null) {
		issue('lock', 'lock is only allowed while the pool is OPEN');
	}
}

export const bulkReturnPoolV3DocSchema = z
	.object({
		_id: bulkReturnPoolIdSchema,
		type: z.literal('bulk_return_pool'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_POOL_V3_SCHEMA_V),
		...bulkReturnPoolV3Fields
	})
	.superRefine(validateBulkReturnPoolV3);
export type BulkReturnPoolV3 = BaseDoc & z.infer<typeof bulkReturnPoolV3DocSchema>;

export const bulkReturnPoolV3InputSchema = z.object({
	name: bulkReturnPoolV3Fields.name,
	location: bulkReturnPoolV3Fields.location,
	notes: bulkReturnPoolV3Fields.notes
});
export type BulkReturnPoolV3Input = z.input<typeof bulkReturnPoolV3InputSchema>;

/** Creates an OPEN pool: no lock, no items_summary, no submit audit, no quantities. */
export function createBulkReturnPoolV3(
	input: BulkReturnPoolV3Input,
	ctx: AuthorContext,
	id?: string
): BulkReturnPoolV3 {
	const parsed = bulkReturnPoolV3InputSchema.parse(input);
	return bulkReturnPoolV3DocSchema.parse(
		makeDoc(
			'bulk_return_pool',
			BULK_RETURN_POOL_V3_SCHEMA_V,
			{ ...parsed, status: 'OPEN' as const },
			ctx,
			id
		)
	) as BulkReturnPoolV3;
}

/**
 * Advisory fence predicate for adding an entry to / moving an entry into a pool.
 * Authoritative enforcement cannot live in validate_doc_update (it cannot see other docs).
 * TODO(#658 Q7): handling of "late" entries/moves that land after a submit/delete lock.
 */
export function canAppendToPool(pool: Pick<BulkReturnPoolV3, 'status' | 'lock'>): boolean {
	return pool.status === 'OPEN' && !pool.lock;
}

const IMMUTABLE_POOL_FIELDS = [
	'_id',
	'type',
	'schema_v',
	'shelter_code',
	'created_at',
	'created_by'
] as const;

function sameJson(a: unknown, b: unknown): boolean {
	return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/**
 * Validates an update of a v3 pool header. Status transitions implemented: OPEN -> SUBMITTED and
 * SUBMITTED -> RECEIVED. Same-status updates are allowed (OPEN: edits/lock; SUBMITTED/RECEIVED:
 * everything except the immutable snapshot fields). Any other transition throws.
 * No role checks. TODO(#658 Q3): roles per transition, including SUBMITTED -> OPEN.
 */
export function assertPoolTransition(prev: BulkReturnPoolV3, next: BulkReturnPoolV3): void {
	for (const field of IMMUTABLE_POOL_FIELDS) {
		if (prev[field] !== next[field]) {
			throw new Error(`bulk_return_pool.${field} is immutable`);
		}
	}
	if (prev.status !== next.status) {
		const allowed =
			(prev.status === 'OPEN' && next.status === 'SUBMITTED') ||
			(prev.status === 'SUBMITTED' && next.status === 'RECEIVED');
		if (!allowed) {
			throw new Error(
				`Invalid bulk_return_pool transition ${prev.status} -> ${next.status} (pending decision, #658 Q3)`
			);
		}
	}
	bulkReturnPoolV3DocSchema.parse(next);

	if (prev.status !== 'OPEN') {
		if (prev.name !== next.name || prev.location !== next.location) {
			throw new Error('bulk_return_pool name/location are immutable once SUBMITTED');
		}
		if (
			!sameJson(prev.items_summary, next.items_summary) ||
			prev.submitted_at !== next.submitted_at ||
			prev.submitted_by !== next.submitted_by
		) {
			throw new Error('bulk_return_pool items_summary and submit audit are immutable once written');
		}
	}
}
