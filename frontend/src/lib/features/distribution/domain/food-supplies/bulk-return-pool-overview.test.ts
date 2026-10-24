import { describe, expect, it } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import { createBulkReturnEntry } from './bulk-return-entry';
import { createBulkReturnEntryMove } from './bulk-return-entry-move';
import { createBulkReturnEntryVoid } from './bulk-return-entry-void';
import { cancelBulkReturnPoolV3, createBulkReturnPoolV3 } from './bulk-return-pool-v3';
import { buildBulkReturnPoolOverview } from './bulk-return-pool-overview';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'staff:wh' };
const P1 = 'bulk_return_pool:01J00000000000000000000011';
const P2 = 'bulk_return_pool:01J00000000000000000000012';
const P3 = 'bulk_return_pool:01J00000000000000000000013';

const poolOf = (id: string, name: string) =>
	createBulkReturnPoolV3({ name }, ctx, id.replace('bulk_return_pool:', ''));
const entryOf = (n: number, pool: string, item: string, qty: string) =>
	createBulkReturnEntry(
		{ pool_id: pool, item_id: item, qty, returner_type: 'unspecified' },
		ctx,
		`01J000000000000000000000${String(n).padStart(2, '0')}`
	);

describe('buildBulkReturnPoolOverview', () => {
	const open1 = poolOf(P1, 'A');
	const open2 = poolOf(P2, 'B');
	const cancelled = cancelBulkReturnPoolV3(poolOf(P3, 'C'), ctx);
	const e1 = entryOf(1, P1, 'item:cot', '5');
	const e2 = entryOf(2, P1, 'item:fan', '2');
	const e3 = entryOf(3, P2, 'item:cot', '1');

	it('returns one row per pool, newest first, with per-item summary and entry count', () => {
		const rows = buildBulkReturnPoolOverview([open1, open2], {
			entries: [e1, e2, e3],
			moves: [],
			voids: []
		});
		expect(rows.map((r) => r.pool._id)).toEqual([P2, P1]);
		const row1 = rows[1];
		expect(row1.entry_count).toBe(2);
		expect(row1.items).toEqual([
			{ item_id: 'item:cot', qty: '5' },
			{ item_id: 'item:fan', qty: '2' }
		]);
		expect(row1.entries.map((r) => r.entry._id)).toEqual([e1._id, e2._id]);
		expect(row1.is_empty).toBe(false);
		expect(row1.late_entries).toEqual([]);
	});

	it('follows moves, nets out voids and flags an empty pool', () => {
		const rows = buildBulkReturnPoolOverview([open1, open2], {
			entries: [e1, e2],
			moves: [
				createBulkReturnEntryMove({ entry: e1, seq: 1, from_pool_id: P1, to_pool_id: P2 }, ctx)
			],
			voids: [createBulkReturnEntryVoid({ entry: e2, pool_id: P1 }, ctx)]
		});
		const byId = new Map(rows.map((r) => [r.pool._id, r]));
		expect(byId.get(P1)!.is_empty).toBe(true);
		expect(byId.get(P1)!.entry_count).toBe(0);
		expect(byId.get(P1)!.entries.map((r) => [r.entry._id, r.voided])).toEqual([[e2._id, true]]);
		expect(byId.get(P2)!.items).toEqual([{ item_id: 'item:cot', qty: '5' }]);
	});

	it('hides CANCELLED pools unless includeCancelled', () => {
		const events = { entries: [], moves: [], voids: [] };
		expect(buildBulkReturnPoolOverview([open1, cancelled], events).map((r) => r.pool._id)).toEqual([
			P1
		]);
		expect(
			buildBulkReturnPoolOverview([open1, cancelled], events, { includeCancelled: true }).map(
				(r) => r.pool._id
			)
		).toEqual([P3, P1]);
	});

	it('reports late entries stuck in a non-OPEN pool', () => {
		const late = entryOf(4, P3, 'item:cot', '1');
		const rows = buildBulkReturnPoolOverview(
			[cancelled],
			{ entries: [late], moves: [], voids: [] },
			{ includeCancelled: true }
		);
		expect(rows[0].late_entries.map((r) => r.entry._id)).toEqual([late._id]);
		expect(rows[0].is_empty).toBe(false);
	});

	it('does not throw on an orphan void and lists it on the pool it names', () => {
		const orphanVoid = createBulkReturnEntryVoid({ entry: e3, pool_id: P2 }, ctx);
		const rows = buildBulkReturnPoolOverview([open1, open2], {
			entries: [e1, e2],
			moves: [],
			voids: [orphanVoid]
		});
		const byId = new Map(rows.map((r) => [r.pool._id, r]));
		expect(byId.get(P2)!.unresolved_refs).toEqual([
			{ kind: 'void', entry_id: e3._id, pool_ids: [P2] }
		]);
		expect(byId.get(P1)!.unresolved_refs).toEqual([]);
		expect(byId.get(P1)!.entry_count).toBe(2);
		expect(byId.get(P2)!.entry_count).toBe(0);
	});

	it('throws on an inconsistent event log', () => {
		expect(() =>
			buildBulkReturnPoolOverview([open1], { entries: [e1, e1], moves: [], voids: [] })
		).toThrow(/Duplicate/);
	});
});
