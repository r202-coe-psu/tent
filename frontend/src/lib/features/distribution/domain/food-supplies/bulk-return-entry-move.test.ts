import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import {
	assertEntryCanBeMoved,
	bulkReturnEntryMoveDocSchema,
	canMoveEntry,
	createBulkReturnEntryMove,
	deriveEntryMoveId,
	foldEntryMoves,
	resolveEntryPool
} from './bulk-return-entry-move';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:dst' };
const OP = '01J00000000000000000000001';
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const P2 = 'bulk_return_pool:01J00000000000000000000012';
const P3 = 'bulk_return_pool:01J00000000000000000000013';

const entry = createBulkReturnEntry(
	{ pool_id: P1, item_id: 'item_master:cot', qty: '5', returner_type: 'unspecified' },
	ctx,
	OP
);
const move = (seq: number, from: string, to: string) =>
	createBulkReturnEntryMove({ entry, seq, from_pool_id: from, to_pool_id: to }, ctx);

describe('deriveEntryMoveId', () => {
	it('zero-pads seq to 4 digits so _id order is seq order', () => {
		expect(deriveEntryMoveId(entry._id, 1)).toBe(`bulk_return_entry_move:${OP}:0001`);
		expect(deriveEntryMoveId(entry._id, 12)).toBe(`bulk_return_entry_move:${OP}:0012`);
		expect(deriveEntryMoveId(entry._id, 2) < deriveEntryMoveId(entry._id, 10)).toBe(true);
	});

	it('rejects a bad entry id and out-of-range seq', () => {
		expect(() => deriveEntryMoveId('bulk_return_entry:x', 1)).toThrow();
		for (const seq of [0, -1, 1.5, 10000]) {
			expect(() => deriveEntryMoveId(entry._id, seq)).toThrow();
		}
	});
});

describe('createBulkReturnEntryMove', () => {
	it('copies item_id/qty from the entry and derives a deterministic id', () => {
		const m = move(1, P1, P2);
		expect(m).toMatchObject({
			_id: `bulk_return_entry_move:${OP}:0001`,
			type: 'bulk_return_entry_move',
			schema_v: 1,
			entry_id: entry._id,
			seq: 1,
			from_pool_id: P1,
			to_pool_id: P2,
			item_id: 'item_master:cot',
			qty: '5',
			created_by: 'staff:dst'
		});
	});

	it('rejects from == to, bad pool ids and bad seq', () => {
		expect(() => move(1, P1, P1)).toThrow(/differ/);
		expect(() => move(1, 'bulk_return_pool:x', P2)).toThrow();
		expect(() => move(0, P1, P2)).toThrow();
	});
});

describe('bulkReturnEntryMoveDocSchema', () => {
	it('requires entry_id and seq to match the _id', () => {
		const m = move(2, P1, P2);
		expect(bulkReturnEntryMoveDocSchema.safeParse(m).success).toBe(true);
		expect(
			bulkReturnEntryMoveDocSchema.safeParse({
				...m,
				entry_id: 'bulk_return_entry:01J00000000000000000000099'
			}).success
		).toBe(false);
		expect(bulkReturnEntryMoveDocSchema.safeParse({ ...m, seq: 3 }).success).toBe(false);
		expect(
			bulkReturnEntryMoveDocSchema.safeParse({ ...m, _id: 'bulk_return_entry_move:x' }).success
		).toBe(false);
		expect(bulkReturnEntryMoveDocSchema.safeParse({ ...m, qty: '0' }).success).toBe(false);
		expect(bulkReturnEntryMoveDocSchema.safeParse({ ...m, schema_v: 2 }).success).toBe(false);
	});
});

describe('canMoveEntry', () => {
	it('is true for an entry with no void and false once it has been voided', () => {
		expect(canMoveEntry(entry._id, [])).toBe(true);
		expect(
			canMoveEntry(entry._id, [{ entry_id: 'bulk_return_entry:01J00000000000000000000099' }])
		).toBe(true);
		expect(canMoveEntry(entry._id, [{ entry_id: entry._id }])).toBe(false);
	});
});

describe('assertEntryCanBeMoved', () => {
	it('throws for a voided entry and passes otherwise', () => {
		expect(() => assertEntryCanBeMoved(entry._id, [])).not.toThrow();
		expect(() => assertEntryCanBeMoved(entry._id, [{ entry_id: entry._id }])).toThrow(/voided/);
	});
});

describe('resolveEntryPool', () => {
	it('returns the original pool when there are no moves', () => {
		expect(resolveEntryPool(entry, [])).toBe(P1);
	});

	it('follows a contiguous chain regardless of input order', () => {
		const m1 = move(1, P1, P2);
		const m2 = move(2, P2, P3);
		const m3 = move(3, P3, P1);
		expect(resolveEntryPool(entry, [m1])).toBe(P2);
		expect(resolveEntryPool(entry, [m3, m1, m2])).toBe(P1);
	});

	it('throws (pending sync) when seq does not start at 1', () => {
		expect(() => resolveEntryPool(entry, [move(2, P1, P2)])).toThrow(
			`Entry ${entry._id} is pending sync: move seq 1 missing`
		);
	});

	it('throws (pending sync) on a seq gap', () => {
		expect(() => resolveEntryPool(entry, [move(1, P1, P2), move(3, P2, P3)])).toThrow(
			/pending sync: move seq 2 missing/
		);
	});

	it('throws on a duplicate seq', () => {
		expect(() => resolveEntryPool(entry, [move(1, P1, P2), move(1, P1, P3)])).toThrow(/contiguous/);
	});

	it('throws when the first move does not leave the entry original pool', () => {
		expect(() => resolveEntryPool(entry, [move(1, P2, P3)])).toThrow(/leaves/);
	});

	it('throws when a move does not leave the previous move target', () => {
		expect(() => resolveEntryPool(entry, [move(1, P1, P2), move(2, P3, P1)])).toThrow(/leaves/);
	});

	it('throws when a move belongs to another entry', () => {
		const other = createBulkReturnEntry(
			{ pool_id: P1, item_id: 'item_master:cot', qty: '5', returner_type: 'unspecified' },
			ctx,
			'01J00000000000000000000002'
		);
		const foreign = createBulkReturnEntryMove(
			{ entry: other, seq: 1, from_pool_id: P1, to_pool_id: P2 },
			ctx
		);
		expect(() => resolveEntryPool(entry, [foreign])).toThrow(/belongs to/);
	});

	it('throws when a move item_id or qty differs from the entry', () => {
		const m = move(1, P1, P2);
		expect(() => resolveEntryPool(entry, [{ ...m, qty: '4' }])).toThrow(/item_id\/qty/);
		expect(() => resolveEntryPool(entry, [{ ...m, item_id: 'item_master:mat' }])).toThrow(
			/item_id\/qty/
		);
	});
});

describe('foldEntryMoves', () => {
	it('resolves to the original pool with no moves', () => {
		expect(foldEntryMoves(entry, [])).toEqual({ status: 'resolved', pool_id: P1 });
	});

	it('resolves a contiguous chain in any order', () => {
		const chain = [move(3, P3, P1), move(1, P1, P2), move(2, P2, P3)];
		expect(foldEntryMoves(entry, chain)).toEqual({ status: 'resolved', pool_id: P1 });
	});

	it('is pending when only seq 2 is present', () => {
		expect(foldEntryMoves(entry, [move(2, P2, P3)])).toEqual({
			status: 'pending',
			missing_seqs: [1],
			pool_ids: [P1, P2, P3]
		});
	});

	it('is pending when seq 2 is missing between 1 and 3', () => {
		expect(foldEntryMoves(entry, [move(3, P3, P1), move(1, P1, P2)])).toEqual({
			status: 'pending',
			missing_seqs: [2],
			pool_ids: [P1, P2, P3]
		});
	});

	it('self-heals once the missing move arrives', () => {
		const m1 = move(1, P1, P2);
		const m2 = move(2, P2, P3);
		expect(foldEntryMoves(entry, [m2]).status).toBe('pending');
		expect(foldEntryMoves(entry, [m2, m1])).toEqual({ status: 'resolved', pool_id: P3 });
	});

	it('still throws on a duplicate seq, also inside a gappy set', () => {
		expect(() => foldEntryMoves(entry, [move(1, P1, P2), move(1, P1, P3)])).toThrow(/contiguous/);
		expect(() =>
			foldEntryMoves(entry, [move(3, P2, P3), move(3, P2, P1), move(1, P1, P2)])
		).toThrow(/contiguous/);
	});

	it('still throws when seq 1 does not leave the original pool, even with a gap elsewhere', () => {
		expect(() => foldEntryMoves(entry, [move(1, P2, P3), move(3, P1, P2)])).toThrow(/leaves/);
	});

	it('still throws on a consecutive from/to mismatch inside a gappy set', () => {
		expect(() => foldEntryMoves(entry, [move(2, P2, P3), move(3, P1, P2)])).toThrow(/leaves/);
	});

	it('still throws on a wrong entry_id and on item/qty mismatch with a gap', () => {
		const other = createBulkReturnEntry(
			{ pool_id: P1, item_id: 'item_master:cot', qty: '5', returner_type: 'unspecified' },
			ctx,
			'01J00000000000000000000002'
		);
		const foreign = createBulkReturnEntryMove(
			{ entry: other, seq: 2, from_pool_id: P1, to_pool_id: P2 },
			ctx
		);
		expect(() => foldEntryMoves(entry, [foreign])).toThrow(/belongs to/);
		const m = move(2, P2, P3);
		expect(() => foldEntryMoves(entry, [{ ...m, qty: '4' }])).toThrow(/item_id\/qty/);
		expect(() => foldEntryMoves(entry, [{ ...m, item_id: 'item_master:mat' }])).toThrow(
			/item_id\/qty/
		);
	});
});
