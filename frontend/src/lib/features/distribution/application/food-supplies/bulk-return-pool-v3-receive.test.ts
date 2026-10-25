// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';

const couch = await vi.hoisted(async () => {
	const { createInMemoryCouch } = await import('$lib/testing/in-memory-couch');
	return createInMemoryCouch();
});

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', () => couch.couchDbModule);

vi.mock('$lib/features/catalog', () => ({
	catalogRepository: () => ({
		listItemMasters: async () => [],
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => value
}));

import type { BulkReturnPoolV3 } from '../../domain/food-supplies';
import { createStockLedger, deriveDeterministicLedgerId } from '$lib/features/operations';
import {
	cancelBulkReturnPool,
	receiveBulkReturnPool,
	submitBulkReturnPool,
	type ReceiveBulkReturnPoolInput
} from './bulk-return-pool-v3-lifecycle';
import {
	BulkReturnPoolStateError,
	StockIntegrityError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';
import {
	catalogOf,
	createBulkReturnPoolV3Fixture,
	dist,
	fullInput,
	items,
	mgr,
	reg,
	U,
	type BulkReturnPoolV3Fixture as Fx
} from './bulk-return-pool-v3.test-support';

describe('bulk return pool v3 workflows', () => {
	let poolRepo: Fx['poolRepo'];
	let operationsRepo: Fx['operationsRepo'];
	let deps: Fx['deps'];
	let nextOp: Fx['nextOp'];
	let openPool: Fx['openPool'];
	let add: Fx['add'];
	let ledgerKeys: Fx['ledgerKeys'];
	let balanceOf: Fx['balanceOf'];
	let submittedPool: Fx['submittedPool'];
	let receive: Fx['receive'];

	beforeEach(() => {
		({
			poolRepo,
			operationsRepo,
			deps,
			nextOp,
			openPool,
			add,
			ledgerKeys,
			balanceOf,
			submittedPool,
			receive
		} = createBulkReturnPoolV3Fixture(couch));
	});

	describe('receiveBulkReturnPool', () => {
		it('books one receive row per item for the received qty; stock only changes at receive', async () => {
			const pool = await submittedPool();
			expect(await balanceOf()).toEqual({});

			const res = await receive(pool._id, fullInput(pool));
			expect(res.replayed).toBe(false);
			expect(res.pool.status).toBe('RECEIVED');
			expect(res.pool.received_by).toBe('user:wh1');
			expect(res.pool.received_items).toEqual([
				{ item_id: 'item:cot', expected_qty: '3', received_qty: '3' },
				{ item_id: 'item:wheelchair', expected_qty: '2', received_qty: '2' }
			]);
			expect(res.ledgerEntries).toHaveLength(2);

			for (const entry of res.ledgerEntries) {
				expect(entry._id).toBe(
					await deriveDeterministicLedgerId('bulk_return_receive', pool._id, entry.item_id)
				);
				expect(entry).toMatchObject({
					type: 'stock_ledger',
					reason: 'receive',
					ref_id: pool._id,
					unit: 'piece',
					occurred_at: res.pool.received_at,
					lot: { note: 'bulk_return_pool' }
				});
				expect(entry.lot?.storage_point_id).toBeUndefined();
				expect(entry.lot_ref).toBe(entry._id);
			}
			expect(res.ledgerEntries.map((e) => [e.item_id, e.qty])).toEqual([
				['item:cot', '3'],
				['item:wheelchair', '2']
			]);
			expect(ledgerKeys()).toHaveLength(2);
			expect(await balanceOf()).toEqual({ 'item:cot': '3', 'item:wheelchair': '2' });
		});

		it('records a short receipt with its discrepancy and books only what arrived', async () => {
			const pool = await submittedPool();
			const res = await receive(pool._id, {
				items: [
					{
						item_id: 'item:cot',
						received_qty: '2',
						discrepancy_reason: 'damaged',
						discrepancy_note: '  cracked frame '
					},
					{ item_id: 'item:wheelchair', received_qty: '2' }
				]
			});
			expect(res.pool.received_items?.[0]).toEqual({
				item_id: 'item:cot',
				expected_qty: '3',
				received_qty: '2',
				discrepancy_reason: 'damaged',
				discrepancy_note: 'cracked frame'
			});
			expect(await balanceOf()).toEqual({ 'item:cot': '2', 'item:wheelchair': '2' });
		});

		it('writes no ledger row for an item received as 0', async () => {
			const pool = await submittedPool();
			const res = await receive(pool._id, {
				items: [
					{ item_id: 'item:cot', received_qty: '0', discrepancy_reason: 'missing' },
					{ item_id: 'item:wheelchair', received_qty: '2' }
				]
			});
			expect(res.pool.status).toBe('RECEIVED');
			expect(res.pool.received_items?.[0]).toMatchObject({
				item_id: 'item:cot',
				received_qty: '0'
			});
			expect(res.ledgerEntries.map((e) => e.item_id)).toEqual(['item:wheelchair']);
			expect(ledgerKeys()).toHaveLength(1);
			expect(await balanceOf()).toEqual({ 'item:wheelchair': '2' });
		});

		it('writes the receive storage point to the pool and the ledger lots', async () => {
			const pool = await submittedPool();
			const res = await receive(pool._id, {
				...fullInput(pool),
				storagePoint: { id: 'sp-9', name: ' Zone 9 ' }
			});
			expect(res.pool.received_storage_point_id).toBe('sp-9');
			expect(res.pool.received_storage_zone).toBe('Zone 9');
			for (const entry of res.ledgerEntries) {
				expect(entry.lot).toMatchObject({
					note: 'bulk_return_pool',
					storage_point_id: 'sp-9',
					storage_zone: 'Zone 9'
				});
			}
			const stored = await operationsRepo.getLedgerEntry(res.ledgerEntries[0]._id);
			expect(stored?.lot?.storage_point_id).toBe('sp-9');
		});

		const invalidInputs: [string, (pool: BulkReturnPoolV3) => ReceiveBulkReturnPoolInput][] = [
			[
				"reason 'other' without a note",
				() => ({
					items: [
						{ item_id: 'item:cot', received_qty: '1', discrepancy_reason: 'other' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			],
			[
				'a mismatch without a reason',
				() => ({
					items: [
						{ item_id: 'item:cot', received_qty: '1' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			],
			[
				'a reason on a full match',
				() => ({
					items: [
						{ item_id: 'item:cot', received_qty: '3', discrepancy_reason: 'miscount' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			],
			[
				'received above expected',
				() => ({
					items: [
						{ item_id: 'item:cot', received_qty: '4' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			],
			['a missing row', () => ({ items: [{ item_id: 'item:cot', received_qty: '3' }] })],
			[
				'an extra row',
				(pool) => ({
					items: [...fullInput(pool).items, { item_id: 'item:rice', received_qty: '1' }]
				})
			],
			[
				'a duplicate row',
				(pool) => ({
					items: [...fullInput(pool).items, { item_id: 'item:cot', received_qty: '3' }]
				})
			],
			[
				'a non-integer qty',
				() => ({
					items: [
						{ item_id: 'item:cot', received_qty: '1.5', discrepancy_reason: 'miscount' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			]
		];

		it.each(invalidInputs)('rejects %s before any write', async (_case, build) => {
			const pool = await submittedPool();
			await expect(receive(pool._id, build(pool))).rejects.toBeInstanceOf(WorkflowValidationError);
			expect((await poolRepo.get(pool._id))?.status).toBe('SUBMITTED');
			expect(ledgerKeys()).toEqual([]);
		});

		it('accepts an other-reason with a note', async () => {
			const pool = await submittedPool();
			const res = await receive(pool._id, {
				items: [
					{
						item_id: 'item:cot',
						received_qty: '1',
						discrepancy_reason: 'other',
						discrepancy_note: 'left at gate'
					},
					{ item_id: 'item:wheelchair', received_qty: '2' }
				]
			});
			expect(res.pool.received_items?.[0].discrepancy_note).toBe('left at gate');
		});

		it('is idempotent: a repeated confirm replays and creates no duplicate ledger rows', async () => {
			const pool = await submittedPool();
			const input = fullInput(pool);
			const first = await receive(pool._id, input);
			const again = await receive(pool._id, input);
			expect(again.replayed).toBe(true);
			expect(again.pool.received_at).toBe(first.pool.received_at);
			expect(again.ledgerEntries.map((e) => e._id)).toEqual(first.ledgerEntries.map((e) => e._id));
			expect(ledgerKeys()).toHaveLength(2);
			expect(await balanceOf()).toEqual({ 'item:cot': '3', 'item:wheelchair': '2' });
		});

		it('rejects a different record, or storage point, on an already RECEIVED pool', async () => {
			const pool = await submittedPool();
			await receive(pool._id, fullInput(pool));

			await expect(
				receive(pool._id, {
					items: [
						{ item_id: 'item:cot', received_qty: '2', discrepancy_reason: 'damaged' },
						{ item_id: 'item:wheelchair', received_qty: '2' }
					]
				})
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			await expect(
				receive(pool._id, { ...fullInput(pool), storagePoint: { id: 'sp-1', name: 'Zone 1' } })
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			expect(ledgerKeys()).toHaveLength(2);
			expect(await balanceOf()).toEqual({ 'item:cot': '3', 'item:wheelchair': '2' });
		});

		it('lets only one of two concurrent receivers win and books only the winning record', async () => {
			const pool = await submittedPool();
			const full = fullInput(pool);
			const short: ReceiveBulkReturnPoolInput = {
				items: [
					{ item_id: 'item:cot', received_qty: '1', discrepancy_reason: 'damaged' },
					{ item_id: 'item:wheelchair', received_qty: '2' }
				]
			};
			const settled = await Promise.allSettled([receive(pool._id, full), receive(pool._id, short)]);
			const won = settled.filter((s) => s.status === 'fulfilled');
			const lost = settled.filter((s): s is PromiseRejectedResult => s.status === 'rejected');
			expect(won).toHaveLength(1);
			expect(lost).toHaveLength(1);
			expect(lost[0].reason).toBeInstanceOf(BulkReturnPoolStateError);

			const stored = await poolRepo.get(pool._id);
			const expected = Object.fromEntries(
				(stored?.received_items ?? []).map((row) => [row.item_id, row.received_qty])
			);
			expect(await balanceOf()).toEqual(expected);
		});

		it('repairs a missing ledger row when the receive is repeated', async () => {
			const pool = await submittedPool();
			const first = await receive(pool._id, fullInput(pool));
			const [keep, lost] = first.ledgerEntries;
			couch.store.delete(lost._id);
			expect(ledgerKeys()).toEqual([keep._id]);

			const again = await receive(pool._id, fullInput(pool));
			expect(again.replayed).toBe(true);
			expect(ledgerKeys().sort()).toEqual([keep._id, lost._id].sort());
			const recreated = await operationsRepo.getLedgerEntry(lost._id);
			expect(recreated).toMatchObject({ item_id: lost.item_id, qty: lost.qty, ref_id: pool._id });
			expect(await balanceOf()).toEqual({ 'item:cot': '3', 'item:wheelchair': '2' });
		});

		it('fails closed on a conflicting ledger row at the derived id', async () => {
			const pool = await submittedPool();
			const id = await deriveDeterministicLedgerId('bulk_return_receive', pool._id, 'item:cot');
			await operationsRepo.addLedgerEntry(
				createStockLedger(
					{
						item_id: 'item:cot',
						qty: '1',
						unit: 'piece',
						reason: 'receive',
						ref_id: pool._id,
						lot: { note: 'bulk_return_pool' }
					},
					mgr,
					id
				)
			);
			await expect(receive(pool._id, fullInput(pool))).rejects.toBeInstanceOf(StockIntegrityError);
			expect(await balanceOf()).toEqual({ 'item:cot': '1' });
		});

		it('fails closed when an existing row sits in another storage point', async () => {
			const pool = await submittedPool();
			await receive(pool._id, { ...fullInput(pool), storagePoint: { id: 'sp-1', name: 'Zone 1' } });
			const id = await deriveDeterministicLedgerId('bulk_return_receive', pool._id, 'item:cot');
			const stored = couch.store.get(id) as unknown as { lot: object };
			couch.store.set(id, {
				...stored,
				lot: { ...stored.lot, storage_point_id: 'sp-other' }
			} as never);
			await expect(
				receive(pool._id, { ...fullInput(pool), storagePoint: { id: 'sp-1', name: 'Zone 1' } })
			).rejects.toBeInstanceOf(StockIntegrityError);
		});

		it('rejects an item without a resolvable unit before any write', async () => {
			const pool = await submittedPool();
			const noWheelchair = { ...deps, catalogRepo: catalogOf([items[0]]) };
			await expect(receive(pool._id, fullInput(pool), mgr, noWheelchair)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			expect((await poolRepo.get(pool._id))?.status).toBe('SUBMITTED');
			expect(ledgerKeys()).toEqual([]);
		});

		it('rejects an OPEN, CANCELLED or missing pool', async () => {
			const open = await openPool('Gate A');
			await expect(
				receive(open._id, { items: [{ item_id: 'item:cot', received_qty: '1' }] })
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const cancelled = await openPool('Gate B');
			await cancelBulkReturnPool(cancelled._id, nextOp(), mgr, deps);
			await expect(
				receive(cancelled._id, { items: [{ item_id: 'item:cot', received_qty: '1' }] })
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			await expect(receive(`bulk_return_pool:${U(82)}`, { items: [] })).rejects.toBeInstanceOf(
				BulkReturnPoolStateError
			);
			expect(ledgerKeys()).toEqual([]);
		});

		it('rejects a malformed operationUlid', async () => {
			const pool = await submittedPool();
			await expect(
				receiveBulkReturnPool(pool._id, fullInput(pool), 'not-a-ulid', mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
		});
	});

	describe('submit / receive authorization', () => {
		it('denies distribution_staff and registration_staff', async () => {
			const open = await openPool('Gate A');
			await add(open._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const pool = await submittedPool('Gate B');

			for (const ctx of [dist, reg]) {
				await expect(submitBulkReturnPool(open._id, nextOp(), ctx, deps)).rejects.toBeInstanceOf(
					WorkflowAuthorizationError
				);
				await expect(receive(pool._id, fullInput(pool), ctx)).rejects.toBeInstanceOf(
					WorkflowAuthorizationError
				);
			}
			expect((await poolRepo.get(open._id))?.status).toBe('OPEN');
			expect((await poolRepo.get(pool._id))?.status).toBe('SUBMITTED');
			expect(ledgerKeys()).toEqual([]);
		});

		it('rejects submit and receive when the endpoint is not central or not writable', async () => {
			const edge = { ...deps, endpointStore: { active: 'edge', isWritable: true } };
			const offline = { ...deps, endpointStore: { active: 'central', isWritable: false } };
			const poolId = `bulk_return_pool:${U(83)}`;
			await expect(submitBulkReturnPool(poolId, nextOp(), mgr, edge)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			await expect(receive(poolId, { items: [] }, mgr, offline)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
		});
	});
});
