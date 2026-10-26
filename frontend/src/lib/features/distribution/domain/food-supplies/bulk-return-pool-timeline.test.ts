import { describe, it, expect } from 'vitest';
import { buildPoolTimeline } from './bulk-return-pool-timeline';
import type { BulkReturnEntry } from './bulk-return-entry';
import type { BulkReturnEntryMove } from './bulk-return-entry-move';
import type { BulkReturnEntryVoid } from './bulk-return-entry-void';
import type { BulkReturnPoolV3 } from './bulk-return-pool-v3';

const POOL_A = 'bulk_return_pool:01JA0000000000000000000001';
const POOL_B = 'bulk_return_pool:01JB0000000000000000000002';
const E1 = 'bulk_return_entry:01JE0000000000000000000001';
const E2 = 'bulk_return_entry:01JE0000000000000000000002';

const at = (n: number) => `2026-01-01T00:00:0${n}.000Z`;

const pool = (id: string, extra: Record<string, unknown> = {}) =>
	({ _id: id, created_at: at(0), created_by: 'user:a', ...extra }) as unknown as BulkReturnPoolV3;

const entry = (id: string, poolId: string, n: number, extra: Record<string, unknown> = {}) =>
	({
		_id: id,
		pool_id: poolId,
		item_id: 'item:cot',
		qty: '2',
		returner_type: 'evacuee',
		returner_id: 'evacuee:x',
		loan_refs: [],
		created_at: at(n),
		created_by: 'user:b',
		...extra
	}) as unknown as BulkReturnEntry;

const move = (entryId: string, seq: number, from: string, to: string, n: number) =>
	({
		_id: `${entryId.replace('bulk_return_entry:', 'bulk_return_entry_move:')}:${seq}`,
		entry_id: entryId,
		seq,
		from_pool_id: from,
		to_pool_id: to,
		item_id: 'item:cot',
		qty: '2',
		created_at: at(n),
		created_by: 'user:c'
	}) as unknown as BulkReturnEntryMove;

const voidOf = (entryId: string, poolId: string, n: number) =>
	({
		_id: entryId.replace('bulk_return_entry:', 'bulk_return_entry_void:'),
		entry_id: entryId,
		pool_id: poolId,
		item_id: 'item:cot',
		qty: '2',
		created_at: at(n),
		created_by: 'user:d'
	}) as unknown as BulkReturnEntryVoid;

describe('buildPoolTimeline', () => {
	const events = {
		entries: [entry(E1, POOL_A, 1), entry(E2, POOL_A, 2)],
		moves: [move(E1, 1, POOL_A, POOL_B, 3)],
		voids: [voidOf(E2, POOL_A, 4)]
	};

	it('lists opened, added, moved out, voided and submitted of the source pool in order', () => {
		const a = pool(POOL_A, { submitted_at: at(5), submitted_by: 'user:e' });
		const timeline = buildPoolTimeline(a, events);
		expect(timeline.map((e) => e.kind)).toEqual([
			'opened',
			'entry_added',
			'entry_added',
			'moved_out',
			'voided',
			'submitted'
		]);
		const out = timeline.find((e) => e.kind === 'moved_out');
		expect(out).toMatchObject({ other_pool_id: POOL_B, entry_id: E1, returner_id: 'evacuee:x' });
		expect(timeline.at(-1)).toMatchObject({ by: 'user:e', at: at(5) });
	});

	it('shows a moved-in entry only as moved_in (not entry_added) in the target pool', () => {
		const timeline = buildPoolTimeline(pool(POOL_B), events);
		expect(timeline.map((e) => e.kind)).toEqual(['opened', 'moved_in']);
		expect(timeline[1]).toMatchObject({ other_pool_id: POOL_A, qty: '2' });
	});

	it('ignores voids recorded in another pool', () => {
		const b = pool(POOL_B, { created_at: at(3) });
		const timeline = buildPoolTimeline(b, {
			entries: events.entries,
			moves: events.moves,
			voids: [voidOf(E1, POOL_A, 4)]
		});
		expect(timeline.map((e) => e.kind)).toEqual(['opened', 'moved_in']);
	});

	it('adds received and cancelled stamps', () => {
		const timeline = buildPoolTimeline(
			pool(POOL_A, {
				received_at: at(6),
				received_by: 'user:r',
				cancelled_at: at(7),
				cancelled_by: 'user:x'
			}),
			{ entries: [], moves: [], voids: [] }
		);
		expect(timeline.map((e) => e.kind)).toEqual(['opened', 'received', 'cancelled']);
	});

	it('a move out and back yields both directions for the pool', () => {
		const timeline = buildPoolTimeline(pool(POOL_A), {
			entries: [entry(E1, POOL_A, 1)],
			moves: [move(E1, 1, POOL_A, POOL_B, 2), move(E1, 2, POOL_B, POOL_A, 3)],
			voids: []
		});
		expect(timeline.map((e) => e.kind)).toEqual(['opened', 'entry_added', 'moved_out', 'moved_in']);
	});

	describe('snapshot pins', () => {
		it('flags a void after the snapshot as no_effect', () => {
			const timeline = buildPoolTimeline(
				pool(POOL_A),
				{ entries: [entry(E2, POOL_A, 1)], moves: [], voids: [voidOf(E2, POOL_A, 4)] },
				new Map([[E2, POOL_A]])
			);
			expect(timeline.find((e) => e.kind === 'voided')?.no_effect).toBe(true);
			expect(timeline.find((e) => e.kind === 'entry_added')?.no_effect).toBeUndefined();
		});

		it('flags a move out after the snapshot as no_effect, on both pools', () => {
			const set = {
				entries: [entry(E1, POOL_A, 1)],
				moves: [move(E1, 1, POOL_A, POOL_B, 4)],
				voids: []
			};
			const pins = new Map([[E1, POOL_A]]);
			expect(
				buildPoolTimeline(pool(POOL_A), set, pins).find((e) => e.kind === 'moved_out')?.no_effect
			).toBe(true);
			expect(
				buildPoolTimeline(pool(POOL_B), set, pins).find((e) => e.kind === 'moved_in')?.no_effect
			).toBe(true);
		});

		it('keeps the move that brought a late entry into the pinned pool effective', () => {
			const set = {
				entries: [entry(E1, POOL_B, 1)],
				moves: [move(E1, 1, POOL_B, POOL_A, 2), move(E1, 2, POOL_A, POOL_B, 6)],
				voids: []
			};
			const timeline = buildPoolTimeline(pool(POOL_A), set, new Map([[E1, POOL_A]]));
			expect(timeline.find((e) => e.kind === 'moved_in')?.no_effect).toBeUndefined();
			expect(timeline.find((e) => e.kind === 'moved_out')?.no_effect).toBe(true);
		});

		it('leaves unpinned entries unchanged', () => {
			const timeline = buildPoolTimeline(
				pool(POOL_A),
				events,
				new Map([['bulk_return_entry:other', POOL_B]])
			);
			expect(timeline.some((e) => e.no_effect)).toBe(false);
		});
	});
});
