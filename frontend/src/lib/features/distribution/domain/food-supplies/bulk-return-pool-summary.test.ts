import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import { createBulkReturnEntryMove } from './bulk-return-entry-move';
import {
	isPoolEmpty,
	resolveBulkReturnEntries,
	summarizePoolItems
} from './bulk-return-pool-summary';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:dst' };
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const P2 = 'bulk_return_pool:01J00000000000000000000012';
const P3 = 'bulk_return_pool:01J00000000000000000000013';

const entryOf = (n: number, pool: string, item: string, qty: string) =>
	createBulkReturnEntry(
		{ pool_id: pool, item_id: item, qty },
		ctx,
		`01J000000000000000000000${String(n).padStart(2, '0')}`
	);

const e1 = entryOf(1, P1, 'item_master:cot', '5');
const e2 = entryOf(2, P1, 'item_master:cot', '2');
const e3 = entryOf(3, P1, 'item_master:blanket', '7');
const e4 = entryOf(4, P2, 'item_master:cot', '1');
const moveOf = (entry: typeof e1, seq: number, from: string, to: string) =>
	createBulkReturnEntryMove({ entry, seq, from_pool_id: from, to_pool_id: to }, ctx);

describe('summarizePoolItems', () => {
	it('sums qty per item_id for entries recorded into the pool, sorted by item_id', () => {
		expect(summarizePoolItems([e1, e2, e3, e4], [], P1)).toEqual([
			{ item_id: 'item_master:blanket', qty: '7' },
			{ item_id: 'item_master:cot', qty: '7' }
		]);
		expect(summarizePoolItems([e1, e2, e3, e4], [], P2)).toEqual([
			{ item_id: 'item_master:cot', qty: '1' }
		]);
	});

	it('moves an entry out of the source pool and into the target pool', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		expect(summarizePoolItems([e1, e2, e3, e4], moves, P1)).toEqual([
			{ item_id: 'item_master:blanket', qty: '7' },
			{ item_id: 'item_master:cot', qty: '2' }
		]);
		expect(summarizePoolItems([e1, e2, e3, e4], moves, P2)).toEqual([
			{ item_id: 'item_master:cot', qty: '6' }
		]);
	});

	it('does not double count after a move chain and a move back', () => {
		const moves = [moveOf(e1, 1, P1, P2), moveOf(e1, 2, P2, P3), moveOf(e1, 3, P3, P1)];
		expect(summarizePoolItems([e1], moves, P1)).toEqual([{ item_id: 'item_master:cot', qty: '5' }]);
		expect(summarizePoolItems([e1], moves, P2)).toEqual([]);
		expect(summarizePoolItems([e1], moves, P3)).toEqual([]);
	});

	it('returns an empty array for an empty pool', () => {
		expect(summarizePoolItems([e1], [], P3)).toEqual([]);
		expect(summarizePoolItems([], [], P1)).toEqual([]);
	});

	it('throws on a broken chain, a move for an unknown entry, or a duplicate entry', () => {
		expect(() => summarizePoolItems([e1], [moveOf(e1, 2, P1, P2)], P1)).toThrow(/contiguous/);
		expect(() => summarizePoolItems([e1], [moveOf(e2, 1, P1, P2)], P1)).toThrow(/unknown entry/);
		expect(() => summarizePoolItems([e1, e1], [], P1)).toThrow(/Duplicate/);
	});
});

describe('isPoolEmpty', () => {
	it('is false while an entry resolves to the pool and true otherwise', () => {
		expect(isPoolEmpty([e1], [], P1)).toBe(false);
		expect(isPoolEmpty([e1], [], P2)).toBe(true);
		expect(isPoolEmpty([], [], P1)).toBe(true);
	});

	it('is true once the only entry has been moved away, false at the target', () => {
		const moves = [moveOf(e1, 1, P1, P2)];
		expect(isPoolEmpty([e1], moves, P1)).toBe(true);
		expect(isPoolEmpty([e1], moves, P2)).toBe(false);
	});
});

describe('resolveBulkReturnEntries', () => {
	it('pairs each entry with its current pool', () => {
		const resolved = resolveBulkReturnEntries([e1, e4], [moveOf(e1, 1, P1, P3)]);
		expect(resolved.map((r) => [r.entry._id, r.pool_id])).toEqual([
			[e1._id, P3],
			[e4._id, P2]
		]);
	});
});
