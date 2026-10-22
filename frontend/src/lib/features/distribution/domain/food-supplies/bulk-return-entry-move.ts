import { z } from 'zod';
import { type AuthorContext, type BaseDoc, makeDoc } from '$lib/db/model';
import {
	bulkReturnPoolIdSchema,
	foodSuppliesBaseDocShape,
	positiveWholeQtySchema,
	ULID_PATTERN
} from './shared';
import { bulkReturnEntryIdSchema, type BulkReturnEntry } from './bulk-return-entry';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';

/**
 * #658 — `bulk_return_entry_move`: an append-only whole-entry move between pools (D3: no partial
 * moves; the loan is untouched). `_id` is `bulk_return_entry_move:{entryULID}:{seq}` with a
 * fixed-width 1-based seq, so `_id` order is seq order and two concurrent "move #n" attempts
 * collide (409) instead of double-counting. Mover/time are the envelope's `created_by` /
 * `created_at`. validate_doc_update cannot check `from_pool_id` against the current pool or that
 * pools are OPEN, nor that the entry is not voided — that is the domain fold (`resolveEntryPool`,
 * `canAppendToPool`, `assertEntryCanBeMoved`).
 */

export const BULK_RETURN_ENTRY_MOVE_SCHEMA_V = 1;
export const BULK_RETURN_ENTRY_MOVE_SEQ_WIDTH = 4;
export const BULK_RETURN_ENTRY_MOVE_MAX_SEQ = 10 ** BULK_RETURN_ENTRY_MOVE_SEQ_WIDTH - 1;

const moveIdRe = new RegExp(
	`^bulk_return_entry_move:(${ULID_PATTERN}):(\\d{${BULK_RETURN_ENTRY_MOVE_SEQ_WIDTH}})$`
);

export const bulkReturnEntryMoveIdSchema = z.string().regex(moveIdRe);

/** `bulk_return_entry_move:{entryULID}:{seq}` for an entry id and 1-based seq. */
export function deriveEntryMoveId(entryId: string, seq: number): string {
	const entryMatch = entryId.match(new RegExp(`^bulk_return_entry:(${ULID_PATTERN})$`));
	if (!entryMatch) throw new Error(`Invalid bulk_return_entry ID format: ${entryId}`);
	if (!Number.isInteger(seq) || seq < 1 || seq > BULK_RETURN_ENTRY_MOVE_MAX_SEQ) {
		throw new Error(`Invalid bulk_return_entry_move seq: ${seq}`);
	}
	return `bulk_return_entry_move:${entryMatch[1]}:${String(seq).padStart(BULK_RETURN_ENTRY_MOVE_SEQ_WIDTH, '0')}`;
}

const bulkReturnEntryMoveFields = {
	entry_id: bulkReturnEntryIdSchema,
	seq: z.number().int().min(1).max(BULK_RETURN_ENTRY_MOVE_MAX_SEQ),
	from_pool_id: bulkReturnPoolIdSchema,
	to_pool_id: bulkReturnPoolIdSchema,
	// Copied from the entry (whole-entry move) so the _sum view needs no join.
	item_id: z.string().min(1),
	qty: positiveWholeQtySchema,
	notes: z.string().trim().min(1).optional()
};

export const bulkReturnEntryMoveDocSchema = z
	.object({
		_id: bulkReturnEntryMoveIdSchema,
		type: z.literal('bulk_return_entry_move'),
		...foodSuppliesBaseDocShape,
		schema_v: z.literal(BULK_RETURN_ENTRY_MOVE_SCHEMA_V),
		...bulkReturnEntryMoveFields
	})
	.superRefine((move, ctx) => {
		if (move.from_pool_id === move.to_pool_id) {
			ctx.addIssue({
				code: 'custom',
				path: ['to_pool_id'],
				message: 'from_pool_id and to_pool_id must differ'
			});
		}
		const match = move._id.match(moveIdRe);
		if (match) {
			if (`bulk_return_entry:${match[1]}` !== move.entry_id) {
				ctx.addIssue({
					code: 'custom',
					path: ['entry_id'],
					message: 'entry_id must match the entry ULID in _id'
				});
			}
			if (Number(match[2]) !== move.seq) {
				ctx.addIssue({ code: 'custom', path: ['seq'], message: 'seq must match the seq in _id' });
			}
		}
	});
export type BulkReturnEntryMove = BaseDoc & z.infer<typeof bulkReturnEntryMoveDocSchema>;

export const bulkReturnEntryMoveInputSchema = z.object({
	entry: z.custom<BulkReturnEntry>(),
	seq: bulkReturnEntryMoveFields.seq,
	from_pool_id: bulkReturnPoolIdSchema,
	to_pool_id: bulkReturnPoolIdSchema,
	notes: bulkReturnEntryMoveFields.notes
});
export type BulkReturnEntryMoveInput = z.input<typeof bulkReturnEntryMoveInputSchema>;

/** Creates move #seq of `entry`, copying item_id/qty from it. */
export function createBulkReturnEntryMove(
	input: BulkReturnEntryMoveInput,
	ctx: AuthorContext
): BulkReturnEntryMove {
	const { entry, seq, from_pool_id, to_pool_id, notes } =
		bulkReturnEntryMoveInputSchema.parse(input);
	return bulkReturnEntryMoveDocSchema.parse(
		makeDoc(
			'bulk_return_entry_move',
			BULK_RETURN_ENTRY_MOVE_SCHEMA_V,
			{
				entry_id: entry._id,
				seq,
				from_pool_id,
				to_pool_id,
				item_id: entry.item_id,
				qty: entry.qty,
				...(notes ? { notes } : {})
			},
			ctx,
			deriveEntryMoveId(entry._id, seq)
		)
	) as BulkReturnEntryMove;
}

/** A voided entry cannot be moved (domain-only: validate_doc_update cannot see the void doc). */
export function canMoveEntry(
	entryId: string,
	voids: readonly Pick<BulkReturnEntryVoid, 'entry_id'>[]
): boolean {
	return !voids.some((v) => v.entry_id === entryId);
}

export function assertEntryCanBeMoved(
	entryId: string,
	voids: readonly Pick<BulkReturnEntryVoid, 'entry_id'>[]
): void {
	if (!canMoveEntry(entryId, voids)) {
		throw new Error(`Cannot move ${entryId}: the entry has been voided`);
	}
}

/**
 * Folds an entry's moves into its current pool id. `moves` are this entry's moves in any order.
 * Throws on a broken chain: wrong entry_id, item_id/qty differing from the entry, seq not
 * contiguous from 1 (gap or duplicate), first move not leaving `entry.pool_id`, or a move whose
 * from_pool_id is not the previous move's to_pool_id.
 */
export function resolveEntryPool(
	entry: Pick<BulkReturnEntry, '_id' | 'pool_id' | 'item_id' | 'qty'>,
	moves: readonly Pick<
		BulkReturnEntryMove,
		'entry_id' | 'seq' | 'from_pool_id' | 'to_pool_id' | 'item_id' | 'qty'
	>[]
): string {
	const sorted = [...moves].sort((a, b) => a.seq - b.seq);
	let current = entry.pool_id;
	for (let i = 0; i < sorted.length; i++) {
		const move = sorted[i];
		if (move.entry_id !== entry._id) {
			throw new Error(`Move ${move.seq} belongs to ${move.entry_id}, not ${entry._id}`);
		}
		if (move.seq !== i + 1) {
			throw new Error(`Move seq must be contiguous from 1 for ${entry._id}; expected ${i + 1}`);
		}
		if (move.item_id !== entry.item_id || move.qty !== entry.qty) {
			throw new Error(`Move ${move.seq} of ${entry._id} does not match entry item_id/qty`);
		}
		if (move.from_pool_id !== current) {
			throw new Error(
				`Move ${move.seq} of ${entry._id} leaves ${move.from_pool_id} but the entry is in ${current}`
			);
		}
		current = move.to_pool_id;
	}
	return current;
}
