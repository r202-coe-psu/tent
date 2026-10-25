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
	catalogRepository: () => ({
		listItemMasters: async () => [],
		listUnitsOfMeasure: async () => []
	}),
	itemMasterUnit: (item: { base_unit?: string; unit?: string }) =>
		item.base_unit ?? item.unit ?? 'piece',
	canonicalizeUnitCode: (value: unknown) => value
}));

import {
	createBulkReturnEntry,
	createBulkReturnEntryMove,
	createDistributionLog,
	submitBulkReturnPoolV3,
	type BulkReturnPoolV3
} from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	BulkReturnPoolV3RemoteRepository,
	DistributionLogRemoteRepository,
	type BulkReturnPoolV3Repository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import {
	createStockLedger,
	deriveDeterministicLedgerId,
	OperationsRemoteRepository
} from '$lib/features/operations';
import {
	addBulkReturnEntries,
	cancelBulkReturnPool,
	getBulkReturnPoolOverview,
	listBulkReturnPoolAppliedLoanRefs,
	listBulkReturnPoolClosedLoanRefs,
	listReturnerOutstandingLoans,
	moveBulkReturnEntry,
	openBulkReturnPool,
	receiveBulkReturnPool,
	submitBulkReturnPool,
	updateBulkReturnPoolHeader,
	voidBulkReturnEntry,
	type BulkReturnPoolV3WorkflowDependencies,
	type ReceiveBulkReturnPoolInput
} from './bulk-return-pool-v3-workflow';
import {
	BulkReturnPoolEmptyError,
	BulkReturnPoolNameTakenError,
	BulkReturnPoolNotEmptyError,
	BulkReturnPoolStateError,
	ConcurrencyCollisionError,
	StockIntegrityError,
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
	{ _id: 'item:cot', returnable: true, base_unit: 'piece' },
	{ _id: 'item:wheelchair', returnable: true, base_unit: 'piece' },
	{ _id: 'item:rice', returnable: false, base_unit: 'kg' }
];

const catalogOf = (masters: unknown[]) =>
	({
		listItemMasters: async () => masters,
		listUnitsOfMeasure: async () => []
	}) as unknown as BulkReturnPoolV3WorkflowDependencies['catalogRepo'];

describe('bulk return pool v3 workflows', () => {
	let poolRepo: BulkReturnPoolV3RemoteRepository;
	let eventRepo: BulkReturnEventRemoteRepository;
	let logRepo: DistributionLogRemoteRepository;
	let operationsRepo: OperationsRemoteRepository;
	let deps: BulkReturnPoolV3WorkflowDependencies;
	let opCounter: number;
	const nextOp = () => U(++opCounter);

	beforeEach(() => {
		couch.reset();
		opCounter = 1000;
		poolRepo = new BulkReturnPoolV3RemoteRepository('SH001');
		eventRepo = new BulkReturnEventRemoteRepository('SH001');
		logRepo = new DistributionLogRemoteRepository('SH001');
		operationsRepo = new OperationsRemoteRepository('shelter_sh001');
		deps = {
			poolRepo,
			eventRepo,
			logRepo,
			operationsRepo,
			catalogRepo: catalogOf(items),
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
			expect(moved.loansApplied).toEqual([loanId(19)]);
			expect(moved.loansSkipped).toEqual([]);
			rows = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(rows.find((r) => r.pool._id === pool._id)?.late_entries).toEqual([]);
			expect(rows.find((r) => r.pool._id === target._id)?.items).toEqual([
				{ item_id: 'item:cot', qty: '2' }
			]);
			// A late entry moved into an OPEN pool applies its loan refs exactly once.
			let loan = await logRepo.get(loanId(19));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
			// The same unit cannot be returned again afterwards.
			const again = await add(target._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			expect(again.results[0].unallocated_qty).toBe('1');
			loan = await logRepo.get(loanId(19));
			expect(loan?.status).toBe('returned');
			expect(loan?.qty_returned).toBe('3');
		});
	});

	describe('loan drift (closed / insufficient / missing loan at apply time)', () => {
		/** A log repo that runs `afterList` right after the returner's loans were listed (allocation). */
		function driftingLogRepo(afterList: () => Promise<unknown>): DistributionLogRepository {
			return {
				create: (i, c) => logRepo.create(i, c),
				get: (id) => logRepo.get(id),
				list: async (f) => {
					const loans = await logRepo.list(f);
					await afterList();
					return loans;
				},
				mutateLogCAS: (id, m) => logRepo.mutateLogCAS(id, m),
				recordReturn: (id, i, c) => logRepo.recordReturn(id, i, c),
				recordClear: (id, i, c) => logRepo.recordClear(id, i, c),
				recordVoid: (id, c, n) => logRepo.recordVoid(id, c, n)
			};
		}

		const clearAsLost = (id: string) =>
			logRepo.recordClear(id, { clear_reason: 'lost', notes: 'lost in the flood' }, mgr);

		const dropOffInput = (poolId: string, qty: string, operationUlid: string) => ({
			pool_id: poolId,
			returner: { type: 'evacuee' as const, id: EVACUEE },
			items: [{ item_id: 'item:cot', qty, operationUlid }]
		});

		it('skips a loan cleared as lost between allocation and apply: no throw, entry kept, loan untouched', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(40, { qty: '3' });
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(40))) };

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);

			const [first] = res.results;
			expect(first.late).toBe(false);
			expect(first.entry.loan_refs).toEqual([{ distribution_log_id: loanId(40), qty: '2' }]);
			expect(first.loansApplied).toEqual([]);
			expect(first.loansSkipped).toEqual([
				{ distribution_log_id: loanId(40), qty: '2', reason: 'closed', outstanding: '3' }
			]);
			expect(entryDocCount()).toBe(1);
			const loan = await logRepo.get(loanId(40));
			expect(loan?.status).toBe('lost');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('is idempotent on retry after drift: same skip, no throw, no second entry, loan unchanged', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(41, { qty: '3' });
			const op = nextOp();
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(41))) };
			await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, drifting);
			const before = await logRepo.get(loanId(41));

			const retry = await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, deps);
			const again = await addBulkReturnEntries(dropOffInput(pool._id, '2', op), mgr, deps);

			expect(retry.results[0].replayed).toBe(true);
			expect(retry.results[0].loansApplied).toEqual([]);
			expect(retry.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(41), qty: '2', reason: 'closed', outstanding: '3' }
			]);
			expect(again.results[0].loansSkipped).toEqual(retry.results[0].loansSkipped);
			expect(entryDocCount()).toBe(1);
			expect(await logRepo.get(loanId(41))).toEqual(before);
		});

		it('skips a ref whose outstanding dropped below ref.qty (no partial apply)', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(42, { qty: '3' });
			const drifting = {
				...deps,
				logRepo: driftingLogRepo(() =>
					logRepo.mutateLogCAS(loanId(42), (cur) => ({
						...cur,
						status: 'partially_returned',
						qty_returned: '2',
						returned_at: '2026-01-01T00:00:00.000Z',
						returned_by: 'user:wh1',
						clear_reason: 'routine'
					}))
				)
			};

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);

			expect(res.results[0].loansApplied).toEqual([]);
			expect(res.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(42), qty: '2', reason: 'insufficient', outstanding: '1' }
			]);
			const loan = await logRepo.get(loanId(42));
			expect(loan?.status).toBe('partially_returned');
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('skips a ref whose loan doc is missing instead of throwing', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '1',
						returner_type: 'evacuee',
						returner_id: EVACUEE,
						loan_refs: [{ distribution_log_id: loanId(99), qty: '1' }]
					},
					mgr,
					op
				)
			);

			const res = await addBulkReturnEntries(dropOffInput(pool._id, '1', op), mgr, deps);

			expect(res.results[0].loansApplied).toEqual([]);
			expect(res.results[0].loansSkipped).toEqual([
				{ distribution_log_id: loanId(99), qty: '1', reason: 'missing' }
			]);
		});

		it('still reports an already applied ref as applied on replay, even when the loan is now returned', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(43, { qty: '3' });
			const op = nextOp();
			const first = await addBulkReturnEntries(dropOffInput(pool._id, '3', op), mgr, deps);
			expect((await logRepo.get(loanId(43)))?.status).toBe('returned');
			expect(first.results[0].loansApplied).toEqual([loanId(43)]);

			const replay = await addBulkReturnEntries(dropOffInput(pool._id, '3', op), mgr, deps);

			expect(replay.results[0].replayed).toBe(true);
			expect(replay.results[0].loansApplied).toEqual([loanId(43)]);
			expect(replay.results[0].loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(43));
			expect(loan?.qty_returned).toBe('3');
			expect(loan?.applied_bulk_entry_ids).toHaveLength(1);
		});

		it('void of an entry with a skipped ref leaves the loan untouched and does not throw', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(44, { qty: '3' });
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(44))) };
			const { results } = await addBulkReturnEntries(
				dropOffInput(pool._id, '2', nextOp()),
				mgr,
				drifting
			);
			const before = await logRepo.get(loanId(44));

			const voided = await voidBulkReturnEntry({ entry_id: results[0].entry._id }, dist, deps);

			expect(voided.replayed).toBe(false);
			expect(voided.loansReverted).toEqual([]);
			expect(await logRepo.get(loanId(44))).toEqual(before);
			expect((await logRepo.get(loanId(44)))?.status).toBe('lost');
		});

		it('lists only actually applied refs (not drift-skipped, not voided entries)', async () => {
			const pool = await openPool('Gate A');
			// Loan 48 is fully consumed by the first entry, so the second one allocates to loan 49.
			await seedLoan(48, { qty: '1', at: '2026-01-01T00:00:00.000Z' });
			await seedLoan(49, { qty: '3', at: '2026-01-02T00:00:00.000Z' });
			const applied = await add(pool._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const appliedEntry = applied.results[0].entry;
			expect(await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps)).toEqual([
				{
					entry_id: appliedEntry._id,
					distribution_log_id: appliedEntry.loan_refs[0].distribution_log_id,
					qty: appliedEntry.loan_refs[0].qty
				}
			]);

			// A drifted entry (its loan is cleared right after allocation) is not listed as applied.
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(49))) };
			await addBulkReturnEntries(dropOffInput(pool._id, '2', nextOp()), mgr, drifting);
			const listed = await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps);
			expect(listed.map((r) => r.entry_id)).toEqual([appliedEntry._id]);

			await voidBulkReturnEntry({ entry_id: appliedEntry._id }, dist, deps);
			expect(await listBulkReturnPoolAppliedLoanRefs(pool._id, mgr, deps)).toEqual([]);
		});

		it('void of an entry whose loan doc is gone does not throw', async () => {
			const pool = await openPool('Gate A');
			const op = nextOp();
			const entry = await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '1',
						returner_type: 'evacuee',
						returner_id: EVACUEE,
						loan_refs: [{ distribution_log_id: loanId(98), qty: '1' }]
					},
					mgr,
					op
				)
			);
			await expect(voidBulkReturnEntry({ entry_id: entry._id }, dist, deps)).resolves.toBeDefined();
		});

		it('keeps counting the entry qty in the pool total and lists the closed ref until void', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(45, { qty: '3' });
			// A plain entry without refs plus a drifted one on loan 45 (cleared right after allocation).
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const drifting = { ...deps, logRepo: driftingLogRepo(() => clearAsLost(loanId(45))) };
			const { results } = await addBulkReturnEntries(
				dropOffInput(pool._id, '2', nextOp()),
				mgr,
				drifting
			);
			const driftedEntryId = results[0].entry._id;

			const [row] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(row.items).toEqual([{ item_id: 'item:cot', qty: '3' }]);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([
				{
					entry_id: driftedEntryId,
					distribution_log_id: loanId(45),
					qty: results[0].entry.loan_refs[0].qty,
					reason: 'closed',
					outstanding: '3'
				}
			]);

			await voidBulkReturnEntry({ entry_id: driftedEntryId }, dist, deps);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([]);
			const [after] = await getBulkReturnPoolOverview({}, mgr, deps);
			expect(after.items).toEqual([{ item_id: 'item:cot', qty: '1' }]);
		});

		it('lists nothing for a pool whose refs were all applied', async () => {
			const pool = await openPool('Gate A');
			await seedLoan(47, { qty: '3' });
			await add(pool._id, { type: 'evacuee', id: EVACUEE }, [{ item_id: 'item:cot', qty: '3' }]);
			expect(await listBulkReturnPoolClosedLoanRefs(pool._id, mgr, deps)).toEqual([]);
		});
	});

	describe('moveBulkReturnEntry', () => {
		/** Writes an entry (cot x2 for the loan `n`) into a pool that is SUBMITTED before the fence. */
		async function addLateEntry(poolId: string) {
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 2) {
						await poolRepo.mutateCAS(poolId, (cur) =>
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
				poolId,
				{ type: 'evacuee', id: EVACUEE },
				[{ item_id: 'item:cot', qty: '2' }],
				mgr,
				racing
			);
			expect(res.results[0].late).toBe(true);
			return res.results[0].entry;
		}

		it('does not double-apply when moving an already-applied entry between OPEN pools', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(21, { qty: '3' });
			const { results } = await add(a._id, { type: 'evacuee', id: EVACUEE }, [
				{ item_id: 'item:cot', qty: '2' }
			]);
			const entryId = results[0].entry._id;
			const moved = await moveBulkReturnEntry({ entry_id: entryId, to_pool_id: b._id }, mgr, deps);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(21));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entryId]);
		});

		it('does not double-apply a late entry when the same move is replayed', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(22, { qty: '3' });
			const entry = await addLateEntry(a._id);
			const input = { entry_id: entry._id, to_pool_id: b._id };
			const first = await moveBulkReturnEntry(input, mgr, deps);
			expect(first.loansApplied).toEqual([loanId(22)]);
			const retry = await moveBulkReturnEntry(input, mgr, deps);
			expect(retry.replayed).toBe(true);
			expect(retry.loansApplied).toEqual([]);
			const loan = await logRepo.get(loanId(22));
			expect(loan?.qty_returned).toBe('2');
			expect(loan?.applied_bulk_entry_ids).toEqual([entry._id]);
		});

		it('applies nothing on a replayed move while the target is still not appendable', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(23, { qty: '3' });
			const entry = await addLateEntry(a._id);
			// First attempt: target locks right after the move doc is written -> nothing applied.
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					if (n === 3) await lockPool(b._id);
				})
			};
			const first = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(first.late).toBe(true);
			expect(first.loansApplied).toEqual([]);
			expect(first.loansSkipped).toEqual([]);
			const retry = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(retry).toMatchObject({ replayed: true, late: true, loansApplied: [] });
			const loan = await logRepo.get(loanId(23));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('moves a late entry whose loan was closed meanwhile without touching the loan', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(24, { qty: '3' });
			const entry = await addLateEntry(a._id);
			await logRepo.recordClear(
				loanId(24),
				{ clear_reason: 'lost', notes: 'lost in the flood' },
				mgr
			);
			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(moved.late).toBe(false);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toHaveLength(1);
			expect(moved.loansSkipped[0]).toMatchObject({
				distribution_log_id: loanId(24),
				reason: 'closed'
			});
			const loan = await logRepo.get(loanId(24));
			expect(loan?.status).toBe('lost');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

		it('applies no loans for a late entry when the target turns non-appendable after the move', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(25, { qty: '3' });
			const entry = await addLateEntry(a._id);
			const racing = {
				...deps,
				poolRepo: racingPoolRepo(poolRepo, async (n) => {
					// 1: target, 2: source, 3: fence
					if (n === 3) await lockPool(b._id);
				})
			};
			const moved = await moveBulkReturnEntry(
				{ entry_id: entry._id, to_pool_id: b._id },
				mgr,
				racing
			);
			expect(moved.late).toBe(true);
			expect(moved.loansApplied).toEqual([]);
			expect(moved.loansSkipped).toEqual([]);
			const loan = await logRepo.get(loanId(25));
			expect(loan?.status).toBe('active');
			expect(loan?.applied_bulk_entry_ids).toBeUndefined();
		});

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
			expect(moved.loansApplied).toEqual([]);
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
			const loanAfterVoid = await logRepo.get(loanId(30));
			let loan = await logRepo.get(loanId(30));
			expect(loan?.status).toBe('active');
			expect(loan?.qty_returned).toBe('0');
			expect(loan?.applied_bulk_entry_ids).toEqual([]);

			const again = await voidBulkReturnEntry({ entry_id: entryId }, dist, deps);
			expect(again.replayed).toBe(true);
			expect(again.loansReverted).toEqual([]);
			expect((await logRepo.get(loanId(30)))?._rev).toBe(loanAfterVoid?._rev);
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

	describe('entry pending sync (move chain gap)', () => {
		// Only move seq 2 (b -> c) has replicated; seq 1 (a -> b) has not.
		async function seedGap() {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const { results } = await add(a._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const entry = results[0].entry;
			await eventRepo.createMove(
				createBulkReturnEntryMove({ entry, seq: 2, from_pool_id: b._id, to_pool_id: c._id }, mgr)
			);
			return { a, b, c, entry };
		}
		const keysWith = (prefix: string) =>
			[...couch.store.keys()].filter((k) => k.startsWith(prefix));

		it('rejects a move and writes nothing', async () => {
			const { a, entry } = await seedGap();
			await expect(
				moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps)
			).rejects.toBeInstanceOf(WorkflowValidationError);
			expect(keysWith('bulk_return_entry_move:')).toHaveLength(1);
		});

		it('rejects a void and writes nothing', async () => {
			const { entry } = await seedGap();
			await expect(voidBulkReturnEntry({ entry_id: entry._id }, mgr, deps)).rejects.toBeInstanceOf(
				WorkflowValidationError
			);
			expect(keysWith('bulk_return_entry_void:')).toHaveLength(0);
		});

		it('does not crash the overview and surfaces the gap on its pools', async () => {
			const { a, b, c } = await seedGap();
			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			for (const row of rows) {
				expect(row.entry_count).toBe(0);
				expect(row.unresolved_refs.map((r) => r.kind)).toEqual(['move_gap']);
			}
			expect(rows.map((r) => r.pool._id).sort()).toEqual([a._id, b._id, c._id].sort());
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

	describe('pool- and entry-scoped event reads', () => {
		const one = async (
			poolId: string,
			item: string,
			qty: string,
			returner: Parameters<typeof add>[1] = { type: 'unspecified' }
		) => (await add(poolId, returner, [{ item_id: item, qty }])).results[0].entry;

		/** An entry doc another pool owns that no schema accepts: a shelter-wide read would throw on it. */
		const plantBadDocIn = (poolId: string) => {
			const id = `bulk_return_entry:${U(777)}`;
			couch.store.set(id, { _id: id, type: 'bulk_return_entry', pool_id: poolId });
		};

		it('submit snapshot includes a moved-in entry and excludes a moved-out one', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const stays = await one(a._id, 'item:cot', '2');
			const movedIn = await one(b._id, 'item:cot', '3');
			const movedOut = await one(a._id, 'item:wheelchair', '1');
			await moveBulkReturnEntry({ entry_id: movedIn._id, to_pool_id: a._id }, mgr, deps);
			await moveBulkReturnEntry({ entry_id: movedOut._id, to_pool_id: c._id }, mgr, deps);

			const submitted = await submitBulkReturnPool(a._id, nextOp(), mgr, deps);
			expect(submitted.items_summary).toEqual([{ item_id: 'item:cot', qty: '5' }]);
			expect(submitted.entry_ids).toEqual([stays._id, movedIn._id].sort());
		});

		it('cancel sees a moved-in entry as live and an entry moved away as gone', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const entry = await one(b._id, 'item:cot', '1');
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps);

			await expect(cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolNotEmptyError
			);
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: c._id }, mgr, deps);
			expect((await cancelBulkReturnPool(a._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('loan-ref reads of a pool include its moved-in entries only', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			await seedLoan(31, { qty: '3' });
			const entry = await one(b._id, 'item:cot', '2', {
				type: 'evacuee',
				id: EVACUEE
			});
			await moveBulkReturnEntry({ entry_id: entry._id, to_pool_id: a._id }, mgr, deps);

			expect(await listBulkReturnPoolAppliedLoanRefs(a._id, mgr, deps)).toHaveLength(1);
			expect(await listBulkReturnPoolAppliedLoanRefs(b._id, mgr, deps)).toHaveLength(0);
			expect(await listBulkReturnPoolClosedLoanRefs(a._id, mgr, deps)).toHaveLength(0);
		});

		it('an invalid doc of another pool does not block submit or cancel of this pool', async () => {
			const a = await openPool('Gate A');
			const empty = await openPool('Gate Empty');
			const b = await openPool('Gate B');
			await one(a._id, 'item:cot', '2');
			plantBadDocIn(b._id);

			const submitted = await submitBulkReturnPool(a._id, nextOp(), mgr, deps);
			expect(submitted.items_summary).toEqual([{ item_id: 'item:cot', qty: '2' }]);
			expect((await cancelBulkReturnPool(empty._id, nextOp(), mgr, deps)).status).toBe('CANCELLED');
		});

		it('an invalid doc of another pool does not block moving or voiding an unrelated entry', async () => {
			const a = await openPool('Gate A');
			const b = await openPool('Gate B');
			const c = await openPool('Gate C');
			const toMove = await one(a._id, 'item:cot', '1');
			const toVoid = await one(a._id, 'item:cot', '1');
			plantBadDocIn(c._id);

			const moved = await moveBulkReturnEntry(
				{ entry_id: toMove._id, to_pool_id: b._id },
				mgr,
				deps
			);
			expect(moved.move.to_pool_id).toBe(b._id);
			const voided = await voidBulkReturnEntry({ entry_id: toVoid._id }, mgr, deps);
			expect(voided.entryVoid.entry_id).toBe(toVoid._id);
		});
	});

	const ledgerKeys = () => [...couch.store.keys()].filter((k) => k.startsWith('stock_ledger:'));
	const balanceOf = async () => Object.fromEntries(await operationsRepo.getBalance());

	/** Opens a pool, drops cot x3 (2 + 1) and wheelchair x2 into it and submits it. */
	async function submittedPool(name = 'Gate A'): Promise<BulkReturnPoolV3> {
		const pool = await openPool(name);
		await add(pool._id, { type: 'unspecified' }, [
			{ item_id: 'item:cot', qty: '2' },
			{ item_id: 'item:wheelchair', qty: '2' }
		]);
		await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
		return submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
	}

	const fullInput = (pool: BulkReturnPoolV3): ReceiveBulkReturnPoolInput => ({
		items: (pool.items_summary ?? []).map((row) => ({
			item_id: row.item_id,
			received_qty: row.qty
		}))
	});

	const receive = (
		poolId: string,
		input: ReceiveBulkReturnPoolInput,
		ctx = mgr,
		d = deps,
		op = nextOp()
	) => receiveBulkReturnPool(poolId, input, op, ctx, d);

	describe('submitBulkReturnPool', () => {
		it('snapshots items_summary and entry_ids, clears the lock and writes no stock', async () => {
			const pool = await openPool('Gate A');
			const first = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:wheelchair', qty: '1' },
				{ item_id: 'item:cot', qty: '2' }
			]);
			const second = await add(pool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '3' }
			]);
			const entryIds = [...first.results, ...second.results].map((r) => r.entry._id).sort();

			const submitted = await submitBulkReturnPool(pool._id, nextOp(), mgr, deps);
			expect(submitted.status).toBe('SUBMITTED');
			expect(submitted.items_summary).toEqual([
				{ item_id: 'item:cot', qty: '5' },
				{ item_id: 'item:wheelchair', qty: '1' }
			]);
			expect(submitted.entry_ids).toEqual(entryIds);
			expect(submitted.lock ?? null).toBeNull();
			expect(submitted.submitted_by).toBe('user:wh1');
			expect(submitted.submitted_at).toBeDefined();
			expect(await poolRepo.get(pool._id)).toMatchObject({ status: 'SUBMITTED' });

			expect(ledgerKeys()).toEqual([]);
			expect(await balanceOf()).toEqual({});
		});

		it('is idempotent: the same operation, another operation and a replay holding its own lock', async () => {
			const pool = await openPool('Gate A');
			await add(pool._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);

			const op = nextOp();
			const first = await submitBulkReturnPool(pool._id, op, mgr, deps);
			expect((await submitBulkReturnPool(pool._id, op, mgr, deps)).submitted_at).toBe(
				first.submitted_at
			);
			expect((await submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).status).toBe('SUBMITTED');

			const other = await openPool('Gate B');
			await add(other._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			const ownOp = nextOp();
			await poolRepo.mutateCAS(other._id, (cur) => ({
				...cur,
				lock: { op: 'SUBMIT', op_id: ownOp, locked_at: now(), locked_by: 'user:wh1' }
			}));
			expect((await submitBulkReturnPool(other._id, ownOp, mgr, deps)).status).toBe('SUBMITTED');
		});

		it('rejects a pool locked by another SUBMIT or CANCEL operation', async () => {
			const a = await openPool('Gate A');
			await add(a._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			await lockPool(a._id);
			await expect(submitBulkReturnPool(a._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);

			const b = await openPool('Gate B');
			await add(b._id, { type: 'unspecified' }, [{ item_id: 'item:cot', qty: '1' }]);
			await poolRepo.mutateCAS(b._id, (cur) => ({
				...cur,
				lock: { op: 'CANCEL', op_id: U(901), locked_at: now(), locked_by: 'user:x' }
			}));
			await expect(submitBulkReturnPool(b._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				ConcurrencyCollisionError
			);
			expect((await poolRepo.get(b._id))?.status).toBe('OPEN');
		});

		it('refuses an empty pool, releases its lock and leaves the pool OPEN', async () => {
			const pool = await openPool('Gate A');
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolEmptyError
			);
			const after = await poolRepo.get(pool._id);
			expect(after?.status).toBe('OPEN');
			expect(after?.lock ?? null).toBeNull();
			// The pool can still be cancelled, and the empty-pool message says so.
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toThrow(/cancel/);
		});

		it('treats a pool whose only entry was voided or moved out as empty', async () => {
			const voidedPool = await openPool('Gate A');
			const movedPool = await openPool('Gate B');
			const target = await openPool('Gate C');
			const a = await add(voidedPool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			const b = await add(movedPool._id, { type: 'unspecified' }, [
				{ item_id: 'item:cot', qty: '1' }
			]);
			await voidBulkReturnEntry({ entry_id: a.results[0].entry._id }, mgr, deps);
			await moveBulkReturnEntry(
				{ entry_id: b.results[0].entry._id, to_pool_id: target._id },
				mgr,
				deps
			);

			for (const pool of [voidedPool, movedPool]) {
				await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
					BulkReturnPoolEmptyError
				);
				const after = await poolRepo.get(pool._id);
				expect(after?.status).toBe('OPEN');
				expect(after?.lock ?? null).toBeNull();
			}
			// The entry that moved in counts for its new pool.
			const moved = await submitBulkReturnPool(target._id, nextOp(), mgr, deps);
			expect(moved.entry_ids).toEqual([b.results[0].entry._id]);
		});

		it('excludes an entry that lands after the submit and reports it late', async () => {
			const pool = await submittedPool();
			const lateEntry = await eventRepo.createEntry(
				createBulkReturnEntry(
					{
						pool_id: pool._id,
						item_id: 'item:cot',
						qty: '4',
						returner_type: 'unspecified',
						loan_refs: []
					},
					mgr,
					nextOp()
				)
			);

			const stored = await poolRepo.get(pool._id);
			expect(stored?.items_summary).toEqual(pool.items_summary);
			expect(stored?.entry_ids).toEqual(pool.entry_ids);
			expect(stored?.entry_ids).not.toContain(lateEntry._id);

			const rows = await getBulkReturnPoolOverview({}, mgr, deps);
			const row = rows.find((r) => r.pool._id === pool._id);
			expect(row?.late_entries.map((r) => r.entry._id)).toEqual([lateEntry._id]);
		});

		it('rejects a missing, CANCELLED or RECEIVED pool', async () => {
			await expect(
				submitBulkReturnPool(`bulk_return_pool:${U(81)}`, nextOp(), mgr, deps)
			).rejects.toBeInstanceOf(BulkReturnPoolStateError);

			const cancelled = await openPool('Gate A');
			await cancelBulkReturnPool(cancelled._id, nextOp(), mgr, deps);
			await expect(submitBulkReturnPool(cancelled._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolStateError
			);

			const pool = await submittedPool('Gate B');
			await receive(pool._id, fullInput(pool));
			// RECEIVED is past SUBMITTED: not an idempotent replay.
			await expect(submitBulkReturnPool(pool._id, nextOp(), mgr, deps)).rejects.toBeInstanceOf(
				BulkReturnPoolStateError
			);
		});
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
