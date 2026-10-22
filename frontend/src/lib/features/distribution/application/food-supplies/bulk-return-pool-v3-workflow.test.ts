// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { now, type AuthorContext } from '$lib/db/model';

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
	catalogRepository: () => ({ listItemMasters: async () => [] })
}));

import { createDistributionLog, submitBulkReturnPoolV3 } from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	BulkReturnPoolV3RemoteRepository,
	DistributionLogRemoteRepository,
	type BulkReturnPoolV3Repository
} from '../../data/food-supplies';
import {
	addBulkReturnEntries,
	cancelBulkReturnPool,
	getBulkReturnPoolOverview,
	listReturnerOutstandingLoans,
	moveBulkReturnEntry,
	openBulkReturnPool,
	updateBulkReturnPoolHeader,
	voidBulkReturnEntry,
	type BulkReturnPoolV3WorkflowDependencies
} from './bulk-return-pool-v3-workflow';
import {
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	WorkflowAuthorizationError,
	WorkflowValidationError
} from './errors';

const U = (n: number) => `01J${String(n).padStart(23, '0')}`;
const TICKET = `requisition_ticket:${U(1)}`;
const EVACUEE = `evacuee:${U(2)}`;
const OTHER_EVACUEE = `evacuee:${U(3)}`;

const mgr: AuthorContext = {
	createdBy: 'user:wh1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:warehouse_staff']
};
const dist: AuthorContext = {
	createdBy: 'user:dist1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:distribution_staff']
};
const reg: AuthorContext = {
	createdBy: 'user:reg1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:registration_staff']
};

const items = [
	{ _id: 'item:cot', returnable: true },
	{ _id: 'item:wheelchair', returnable: true },
	{ _id: 'item:rice', returnable: false }
];

describe('bulk return pool v3 workflows', () => {
	let poolRepo: BulkReturnPoolV3RemoteRepository;
	let eventRepo: BulkReturnEventRemoteRepository;
	let logRepo: DistributionLogRemoteRepository;
	let deps: BulkReturnPoolV3WorkflowDependencies;
	let opCounter: number;
	const nextOp = () => U(++opCounter);

	beforeEach(() => {
		couch.reset();
		opCounter = 1000;
		poolRepo = new BulkReturnPoolV3RemoteRepository('SH001');
		eventRepo = new BulkReturnEventRemoteRepository('SH001');
		logRepo = new DistributionLogRemoteRepository('SH001');
		deps = {
			poolRepo,
			eventRepo,
			logRepo,
			catalogRepo: {
				listItemMasters: async () => items
			} as unknown as BulkReturnPoolV3WorkflowDependencies['catalogRepo'],
			endpointStore: { active: 'central', isWritable: true }
		};
	});

	const openPool = (name: string, ctx = mgr) => openBulkReturnPool({ name }, nextOp(), ctx, deps);

	async function seedLoan(
		n: number,
		o: { recipient?: string; item?: string; qty?: string; at?: string } = {}
	) {
		const doc = createDistributionLog(
			{
				ticket_id: TICKET,
				item_id: o.item ?? 'item:cot',
				qty: o.qty ?? '3',
				recipient_type: 'evacuee',
				recipient_id: o.recipient ?? EVACUEE,
				is_returnable: true,
				is_override: false,
				distributed_at: o.at ?? '2026-01-01T00:00:00.000Z'
			},
			mgr,
			`distribution_log:${U(n)}`
		);
		return logRepo.create(doc, mgr);
	}

	const loanId = (n: number) => `distribution_log:${U(n)}`;

	function add(
		poolId: string,
		returner: Parameters<typeof addBulkReturnEntries>[0]['returner'],
		list: { item_id: string; qty: string }[],
		ctx = mgr,
		d = deps
	) {
		return addBulkReturnEntries(
			{
				pool_id: poolId,
				returner,
				items: list.map((i) => ({ ...i, operationUlid: nextOp() }))
			},
			ctx,
			d
		);
	}

	const entryDocCount = () =>
		[...couch.store.keys()].filter((k) => k.startsWith('bulk_return_entry:')).length;

	function racingPoolRepo(
		real: BulkReturnPoolV3Repository,
		onGet: (n: number) => Promise<void>
	): BulkReturnPoolV3Repository {
		let n = 0;
		return {
			create: (p) => real.create(p),
			get: async (id) => {
				n++;
				await onGet(n);
				return real.get(id);
			},
			list: () => real.list(),
			update: (p) => real.update(p),
			mutateCAS: (id, m) => real.mutateCAS(id, m)
		};
	}

	const lockPool = (poolId: string) =>
		poolRepo.mutateCAS(poolId, (cur) => ({
			...cur,
			lock: { op: 'SUBMIT', op_id: U(900), locked_at: now(), locked_by: 'user:x' }
		}));

	describe('openBulkReturnPool', () => {
		it('opens an empty pool with a location snapshot and no quantity', async () => {
			const pool = await openBulkReturnPool(
				{ name: ' Gate A ', storagePoint: { id: 'sp1', name: 'Zone 1' }, notes: 'n' },
				nextOp(),
				mgr,
				deps
			);
			expect(pool.status).toBe('OPEN');
			expect(pool.name).toBe('Gate A');
			expect(pool.location_storage_point_id).toBe('sp1');
			expect(pool.location_storage_zone).toBe('Zone 1');
			expect(pool.notes).toBe('n');
			expect(pool.items_summary).toBeUndefined();
		});

		it('rejects a duplicate name among OPEN pools', async () => {
			await openPool('Gate A');
			await expect(openPool('  gate   a ')).rejects.toBeInstanceOf(BulkReturnPoolNameTakenError);
		});

		it('is idempotent for the same operationUlid', async () => {
			const op = nextOp();
			const first = await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			const second = await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			expect(second._id).toBe(first._id);
			expect((await poolRepo.list()).length).toBe(1);
		});

		it('reports a collision when the operationUlid was used for another name', async () => {
			const op = nextOp();
			await openBulkReturnPool({ name: 'Gate A' }, op, mgr, deps);
			await expect(openBulkReturnPool({ name: 'Gate B' }, op, mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
		});
	});

	describe('updateBulkReturnPoolHeader', () => {
		it('renames, sets and clears location and notes', async () => {
			const pool = await openPool('Gate A');
			const set = await updateBulkReturnPoolHeader(
				pool._id,
				{ name: 'Gate B', storagePoint: { id: 'sp1', name: 'Zone 1' }, notes: 'x' },
				mgr,
				deps
			);
			expect(set.name).toBe('Gate B');
			expect(set.location_storage_zone).toBe('Zone 1');
			const cleared = await updateBulkReturnPoolHeader(
				pool._id,
				{ storagePoint: null, notes: null },
				mgr,
				deps
			);
			expect(cleared.location_storage_point_id).toBeUndefined();
			expect(cleared.location_storage_zone).toBeUndefined();
			expect(cleared.notes).toBeUndefined();
			expect(cleared.name).toBe('Gate B');
		});

		it('rejects a duplicate name of another OPEN pool but allows keeping its own', async () => {
			const a = await openPool('Gate A');
			await openPool('Gate B');
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'gate b' }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolNameTakenError);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'GATE A' }, mgr, deps)
			).resolves.toBeDefined();
		});

		it('rejects a locked pool', async () => {
			const a = await openPool('Gate A');
			await lockPool(a._id);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'X' }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});
	});

	describe('addBulkReturnEntries', () => {
		it('adds several item kinds repeatedly and the overview sums per item', async () => {
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '2' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '3' }]);

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.entry_count).toBe(3);
			expect(row.items).toEqual([
				{ item_id: 'item:cot', qty: '5' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			expect(row.is_empty).toBe(false);
		});

		it('lend 3, return 2 leaves 1 outstanding; a later return of 1 closes the loan', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(10, { qty: '3' });

			const first = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(first.returner_had_outstanding_loans).toBe(true);
			expect(first.no_outstanding_loan).toBe(false);
			expect(first.results[0].loansApplied).toEqual([loanId(10)]);
			expect(first.results[0].unallocated_qty).toBe('0');
			let loan = await logRepo.get(loanId(10));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([first.results[0].entry._id]);

			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '1' }]);
			loan = await logRepo.get(loanId(10));
			expect(loan?.status).toBe('returned');
			expect(loan?.qty_returned).toBe('3');
		});

		it('allocates oldest-first across loans', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(11, { qty: '2', at: '2026-01-02T00:00:00.000Z' });
			await seedLoan(12, { qty: '2', at: '2026-01-01T00:00:00.000Z' });

			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			expect(res.results[0].entry.loan_refs).toEqual([
				{ distribution_log_id: loanId(12), qty: '2' },
				{ distribution_log_id: loanId(11), qty: '1' }
			]);
			expect((await logRepo.get(loanId(12)))?.status).toBe('returned');
			expect((await logRepo.get(loanId(11)))?.status).toBe('partially_returned');
		});

		it('keeps quantity beyond the outstanding as unallocated', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(13, { qty: '2' });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '5' }
			]);
			const [r] = res.results;
			expect(r.entry.qty).toBe('5');
			expect(r.entry.loan_refs).toEqual([{ distribution_log_id: loanId(13), qty: '2' }]);
			expect(r.unallocated_qty).toBe('3');
		});

		it('does not allocate the same outstanding twice for two items of the same call', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(14, { qty: '2' });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' },
				{ item_id: 'item:cot', qty: '1' }
			]);
			expect(res.results.map((r) => r.loansApplied)).toEqual([[loanId(14)], [loanId(14)]]);
			expect((await logRepo.get(loanId(14)))?.status).toBe('returned');
		});

		it('allows a returner with no outstanding loan (flagged), without loan refs', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(15, { recipient: OTHER_EVACUEE });
			const res = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(res.no_outstanding_loan).toBe(true);
			expect(res.returner_had_outstanding_loans).toBe(false);
			expect(res.results[0].entry.loan_refs).toEqual([]);
			expect(res.results[0].unallocated_qty).toBe('2');
			expect((await logRepo.get(loanId(15)))?.status).toBe('active');
		});

		it('writes no loan refs for an unspecified returner', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(16);
			const res = await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '2' }]);
			expect(res.no_outstanding_loan).toBe(false);
			expect(res.returner_had_outstanding_loans).toBe(false);
			expect(res.results[0].entry.returner_type).toBe('unspecified');
			expect(res.results[0].entry.returner_id).toBeNull();
			expect(res.results[0].entry.loan_refs).toEqual([]);
			expect((await logRepo.get(loanId(16)))?.status).toBe('active');
		});

		it('rejects a non-returnable or unknown item before any write', async () => {
			const pool = await openPool('Gate A');
			await expect(
				add(pool._id, { type: 'unspecified' }, [
					{ item_id: 'item:cot', qty: '1' },
					{ item_id: 'item:rice', qty: '1' }
				])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:ghost', qty: '1' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(entryDocCount()).toBe(0);
		});

		it('rejects empty items, bad qty and a malformed returner', async () => {
			const pool = await openPool('Gate A');
			await expect(add(pool._id, { type: 'unspecified' }, [])).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1.5' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				add(pool._id, { type: 'evacuee', id: 'volunteer:x' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(entryDocCount()).toBe(0);
		});

		it('rejects a locked, non-OPEN or missing pool before any write', async () => {
			const pool = await openPool('Gate A');
			await lockPool(pool._id);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const other = await openPool('Gate B');
			await cancelBulkReturnPool(other._id, nextOp(), mgr, deps);
			await expect(
				add(other._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			await expect(
				add(`bulk_return_pool:${U(77)}`, { type: 'unspecified' }, [
					{ item_id: 'item:cot', qty: '1' }
				])
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			expect(entryDocCount()).toBe(0);
		});

		it('does not double-apply loans when replayed with the same operationUlids', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(17, { qty: '3' });
			const input = {
				pool_id: pool._id,
				returner: { type: 'evacuee', id: EVACUEE } as const,
				items: [{ item_id: 'item:cot', qty: '2', operationUlid: nextOp() }]
			};
			const first = await addBulkReturnEntries(input, mgr, deps);
			const second = await addBulkReturnEntries(input, mgr, deps);

			expect(first.results[0].replayed).toBe(false);
			expect(second.results[0].replayed).toBe(true);
			expect(second.results[0].entry._id).toBe(first.results[0].entry._id);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(17));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toHaveLength(1);
		});

		it('rejects a replayed operationUlid whose content differs', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			await addBulkReturnEntries(
				{
					pool_id: pool._id,
					returner: { type: 'unspecified' },
					items: [{ item_id: 'item:cot', qty: '2', operationUlid: op }]
				},
				mgr,
				deps
			);
			await expect(
				addBulkReturnEntries(
					{
						pool_id: pool._id,
						returner: { type: 'unspecified' },
						items: [{ item_id: 'item:cot', qty: '3', operationUlid: op }]
					},
					mgr,
					deps
				)
			).rejects.toBeInstanceOf(ConcurrencyCollisionError);
		});

		it('marks the entry late and leaves loans untouched when the pool is locked after the write', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(18, { qty: '3' });
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) await lockPool(pool._id);
				})
			};
			const res = await add(
				pool._id,
				{ type: 'evacuee', id: EVACUEE },
				[
					{ item_id: 'item:cot', qty: '2' },
					{ item_id: 'item:wheelchair', qty: '1' }
				],
				mgr,
				racing
			);
			// Fence tripped on the first item: it is reported late and later items are not written.
			expect(res.results).toHaveLength(1);
			expect(res.results[0].late).toBe(true);
			expect(res.results[0].loansApplied).toEqual([]);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(18));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('lists a late entry in a SUBMITTED pool and lets it be moved to an OPEN pool', async () => {
			const pool = await openPool('Gate A');
			const target = await openPool('Gate B');
			await seedLoan(19, { qty: '3' });
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) {
						await poolRepo.mutateCAS(pool._id, (cur) =>
							submitBulkReturnPoolV3(
								cur,
								{
									items_summary: [{ item_id: 'item:wheelchair', qty: '1' }],
									entry_ids: [`bulk_return_entry:${U(999)}`]
								},
								mgr
							)
						);
					}
				})
			};
			const res = await add(
				pool._id,
				{ type: 'evacuee', id: EVACUEE },
				[{ item_id: 'item:cot', qty: '2' }],
				mgr,
				racing
			);
			const entry = res.results[0].entry;
			expect(res.results[0].late).toBe(true);
			expect((await logRepo.get(loanId(19)))?.status).toBe('active');

			let rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const poolRow = rows.find((r) => r.pool._id === pool._id);
			expect(poolRow?.late_entries.map((r) => r.entry._id)).toEqual([entry._id]);

			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: target._id },
				dist,
				deps
			);
			expect(moved.late).toBe(false);
			expect(moved.move.seq).toBe(1);
			rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows.find((r) => r.pool._id === pool._id)?.late_entries).toEqual([]);
			expect(rows.find((r) => r.pool._id === target._id)?.items).toEqual([
				{ item_id: 'item:cot', qty: '2' }
			]);
			// Loans are not touched by a move.
			expect((await logRepo.get(loanId(19)))?.status).toBe('active');
		});
	});

	describe('moveBulkReturnEntry', () => {
		it('moves an entry between OPEN pools without touching loans', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(20, { qty: '3' });
			const { results } = await add(a._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const entryId = results[0].entry._id;

			const moved = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps);
			expect(moved).toMatchObject({ late: false, replayed: false });
			expect(moved.move.from_pool_id).toBe(a._id);
			expect(moved.move.to_pool_id).toBe(b._id);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows.find((r) => r.pool._id === a._id)?.is_empty).toBe(true);
			expect(rows.find((r) => r.pool._id === b._id)?.entry_count).toBe(1);
			expect((await logRepo.get(loanId(20)))?.qty_returned).toBe('2');

			// Second move uses seq 2 and leaves b again.
			const back = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: a._id }, mgr, deps);
			expect(back.move.seq).toBe(2);
		});

		it('replays a retry of a successful move without creating a second move doc', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;
			const input = { entry_id: entryId, to_pool_id: b._id };

			const first = await moveBulkReturnEntry(input, mgr, deps);
			const retry = await moveBulkReturnEntry(input, mgr, deps);
			expect(retry.replayed).toBe(true);
			expect(retry.late).toBe(false);
			expect(retry.move._id).toBe(first.move._id);
			const { moves } = await eventRepo.listAll();
			expect(moves.filter((m) => m.entry_id === entryId)).toHaveLength(1);
		});

		it('still rejects moving an entry to the pool it was created in (no move)', async () => {
			const a = await openPool('Gate A');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await expect(
				moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			const { moves } = await eventRepo.listAll();
			expect(moves).toHaveLength(0);
		});

		it('rejects a non-OPEN target, the same pool, a missing entry and a voided entry', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;

			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				moveBulkReturnEntry(
					{ entry_id: `bulk_return_entry:${U(55)}`, to_pool_id: b._id },
					mgr,
					deps
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);

			await lockPool(b._id);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const c = await openPool('Gate C');
			await voidBulkReturnEntry({ entry_id: entryId }, mgr, deps);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: c._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
		});

		it('rejects moving an entry out of a locked pool that is not late', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await lockPool(a._id);
			await expect(
				moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: b._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});

		it('reports late when the target stops accepting right after the move', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					// 1: target, 2: source, 3: fence
					if (n === 3) await lockPool(b._id);
				})
			};
			const moved = await moveBulkReturnEntry(
				{ entry_id: results[0].entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(moved.late).toBe(true);
		});
	});

	describe('voidBulkReturnEntry', () => {
		it('reopens the loan, clears applied ids and is idempotent on replay', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(30, { qty: '3' });
			const { results } = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			const entryId = results[0].entry._id;
			expect((await logRepo.get(loanId(30)))?.status).toBe('returned');

			const voided = await voidBulkReturnEntry({ entry_id: entryId, notes: 'oops' }, dist, deps);
			expect(voided.replayed).toBe(false);
			expect(voided.loansReverted).toEqual([loanId(30)]);
			let loan = await logRepo.get(loanId(30));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');
			expect(loan?.applied_bulk_entry_ids).toEqual([]);

			const again = await voidBulkReturnEntry({ entry_id: entryId }, dist, deps);
			expect(again.replayed).toBe(true);
			expect(again.entryVoid._id).toBe(voided.entryVoid._id);
			loan = await logRepo.get(loanId(30));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.is_empty).toBe(true);
			expect(row.items).toEqual([]);
		});

		it('reverts one of two entries to partially_returned', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(31, { qty: '3' });
			const first = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);
			await voidBulkReturnEntry({ entry_id: first.results[0].entry._id }, mgr, deps);
			const loan = await logRepo.get(loanId(31));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
		});

		it('rejects a missing entry and a pool that is not OPEN and unlocked', async () => {
			const pool = await openPool('Gate A');
			const { results } = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await expect(
				voidBulkReturnEntry({ entry_id: `bulk_return_entry:${U(56)}` }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);

			await lockPool(pool._id);
			await expect(
				voidBulkReturnEntry({ entry_id: results[0].entry._id }, mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
			expect(
				[...couch.store.keys()].filter((k) => k.startsWith('bulk_return_entry_void:'))
			).toHaveLength(0);
		});
	});

	describe('cancelBulkReturnPool', () => {
		it('refuses a non-empty pool, clears the lock, then cancels after the entries are moved out', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);

			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolNotEmptyError
			);
			const stillOpen = await poolRepo.get(a._id);
			expect(stillOpen?.status).toBe('OPEN');
			expect(stillOpen?.lock ?? null).toBeNull();

			await moveBulkReturnEntry({ entry_id: results[0].entry._id, to_pool_id: b._id }, mgr, deps);

			const op = nextOp();
			const cancelled = await cancelBulkReturnPool(a._id, op, mgr, deps);
			expect(cancelled.status).toBe('CANCELLED');
			expect(cancelled.cancelled_by).toBe('user:wh1');
			expect(cancelled.lock ?? null).toBeNull();
			expect(await poolRepo.get(a._id)).not.toBeNull();

			// Idempotent: same op and a different op both return the cancelled pool.
			expect((await cancelBulkReturnPool(a._id, op, mgr, deps)).status).toBe('CANCELLED');
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');

			// Hidden from the default overview, visible on request.
			expect((await getBulkReturnPoolOverview({}, mgr, deps)).map((r) => r.pool._id)).toEqual([
				b._id
			]);
			expect(
				(await getBulkReturnPoolOverview({ includeCancelled: true }, mgr, deps)).map(
					(r) => r.pool._id
				)
			).toHaveLength(2);
		});

		it('treats a voided entry as empty', async () => {
			const a = await openPool('Gate A');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await voidBulkReturnEntry({ entry_id: results[0].entry._id }, mgr, deps);
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('continues a replay holding its own CANCEL lock and rejects another operation lock', async () => {
			const a = await openPool('Gate A');
			const op = nextOp();
			await poolRepo.mutateCAS(a._id, (cur) => ({
				...cur,
				lock: { op: 'CANCEL', op_id: op, locked_at: now(), locked_by: 'user:wh1' }
			}));
			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
			expect((await cancelBulkReturnPool(a._id, op, mgr, deps)).status).toBe('CANCELLED');
		});

		it('rejects a missing pool', async () => {
			await expect(
				cancelBulkReturnPool(`bulk_return_pool:${U(78)}`, nextOp(), mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);
		});
	});

	describe('listReturnerOutstandingLoans', () => {
		it('returns only the returner outstanding returnable loans, oldest first', async () => {
			await seedLoan(40, { qty: '2', at: '2026-01-03T00:00:00.000Z' });
			await seedLoan(41, { qty: '2', item: 'item:wheelchair', at: '2026-01-01T00:00:00.000Z' });
			await seedLoan(42, { recipient: OTHER_EVACUEE });
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '2' }]);

			const loans = await listReturnerOutstandingLoans(EVACUEE, mgr, deps);
			expect(loans.map((l) => l._id)).toEqual([loanId(41)]);
			await expect(listReturnerOutstandingLoans('household:x', mgr, deps)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
		});
	});

	describe('authorization and endpoint', () => {
		it('denies registration_staff every mutating workflow', async () => {
			const pool = await openPool('Gate A');
			const { results } = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entryId = results[0].entry._id;
			const denied = WorkflowAuthorizationError;
			await expect(openPool('Gate Z', reg)).rejects.toBeInstanceOf(denied);
			await expect(
				updateBulkReturnPoolHeader(pool._id, { name: 'Q' }, reg, deps)
			).rejects.toBeInstanceOf(denied);
			await expect(cancelBulkReturnPool(pool._id, nextOp(), reg, deps)).rejects.toBeInstanceOf(
				denied
			);
			await expect(
				add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }], reg)
			).rejects.toBeInstanceOf(denied);
			await expect(
				moveBulkReturnEntry({ entry_id: entryId, to_pool_id: pool._id }, reg, deps)
			).rejects.toBeInstanceOf(denied);
			await expect(voidBulkReturnEntry({ entry_id: entryId }, reg, deps)).rejects.toBeInstanceOf(
				denied
			);
		});

		it('lets distribution_staff add, move and void but not open, update or cancel', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await expect(openPool('Gate Z', dist)).rejects.toBeInstanceOf(WorkflowAuthorizationError);
			await expect(
				updateBulkReturnPoolHeader(a._id, { name: 'Q' }, dist, deps)
			).rejects.toBeInstanceOf(WorkflowAuthorizationError);
			await expect(cancelBulkReturnPool(a._id, nextOp(), dist, deps)).rejects.toBeInstanceOf(
				WorkflowAuthorizationError
			);

			const { results } = await add(
				a._id,
				{ type: 'unspecified' },
				[{ item_id: 'item:cot', qty: '1' }],
				dist
			);
			const entryId = results[0].entry._id;
			await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, dist, deps);
			const voided = await voidBulkReturnEntry({ entry_id: entryId }, dist, deps);
			expect(voided.replayed).toBe(false);
		});

		it('rejects writes when the endpoint is not central or not writable, before any other check', async () => {
			const edge = { ...deps, endpointStore: { active: 'edge', isWritable: true } };
			const offline = { ...deps, endpointStore: { active: 'central', isWritable: false } };
			await expect(openBulkReturnPool({ name: 'X' }, nextOp(), reg, edge)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			await expect(
				openBulkReturnPool({ name: 'X' }, nextOp(), mgr, offline)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				addBulkReturnEntries(
					{ pool_id: `bulk_return_pool:${U(79)}`, returner: { type: 'unspecified' }, items: [] },
					mgr,
					edge
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				cancelBulkReturnPool(`bulk_return_pool:${U(79)}`, nextOp(), mgr, edge)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				voidBulkReturnEntry({ entry_id: `bulk_return_entry:${U(80)}` }, mgr, offline)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				moveBulkReturnEntry(
					{ entry_id: `bulk_return_entry:${U(80)}`, to_pool_id: `bulk_return_pool:${U(79)}` },
					mgr,
					offline
				)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			await expect(
				updateBulkReturnPoolHeader(`bulk_return_pool:${U(79)}`, { name: 'Q' }, mgr, edge)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(couch.store.size).toBe(0);
		});
	});
});
