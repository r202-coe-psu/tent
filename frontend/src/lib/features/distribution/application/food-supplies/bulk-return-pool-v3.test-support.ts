/**
 * Shared fixtures and fakes for the bulk return pool v3 workflow tests
 * (`bulk-return-pool-v3-*.test.ts`). Not a test file itself (no `.test.ts` suffix).
 *
 * The importing test file must keep its own `vi.mock` blocks (`$lib/db/shelter`, `$lib/db/couch-db`,
 * `$lib/features/catalog`) and the hoisted in-memory couch; this module only builds on top of them.
 */
import { now, type AuthorContext } from '$lib/db/model';
import type { createInMemoryCouch } from '$lib/testing/in-memory-couch';
import { OperationsRemoteRepository } from '$lib/features/operations';
import { createDistributionLog, type BulkReturnPoolV3 } from '../../domain/food-supplies';
import {
	BulkReturnEventRemoteRepository,
	BulkReturnPoolV3RemoteRepository,
	DistributionLogRemoteRepository,
	type BulkReturnPoolV3Repository,
	type DistributionLogRepository
} from '../../data/food-supplies';
import {
	openBulkReturnPool,
	receiveBulkReturnPool,
	submitBulkReturnPool,
	type ReceiveBulkReturnPoolInput
} from './bulk-return-pool-v3-lifecycle';
import { addBulkReturnEntries } from './bulk-return-pool-v3-add-entry';
import type { BulkReturnPoolV3WorkflowDependencies } from './bulk-return-pool-v3-shared';

type InMemoryCouch = ReturnType<typeof createInMemoryCouch>;

export const U = (n: number) => `01J${String(n).padStart(23, '0')}`;
const TICKET = `requisition_ticket:${U(1)}`;
export const EVACUEE = `evacuee:${U(2)}`;
export const OTHER_EVACUEE = `evacuee:${U(3)}`;

export const mgr: AuthorContext = {
	createdBy: 'user:wh1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:warehouse_staff']
};
export const dist: AuthorContext = {
	createdBy: 'user:dist1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:distribution_staff']
};
export const sm: AuthorContext = {
	createdBy: 'user:sm1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:shelter_manager']
};
export const reg: AuthorContext = {
	createdBy: 'user:reg1',
	shelterCode: 'SH001',
	roles: ['shelter:SH001', 'SH001:registration_staff']
};

export const items = [
	{ _id: 'item:cot', returnable: true, base_unit: 'piece' },
	{ _id: 'item:wheelchair', returnable: true, base_unit: 'piece' },
	{ _id: 'item:rice', returnable: false, base_unit: 'kg' }
];

export const catalogOf = (masters: unknown[]) =>
	({
		listItemMasters: async () => masters,
		listUnitsOfMeasure: async () => []
	}) as unknown as BulkReturnPoolV3WorkflowDependencies['catalogRepo'];

export const loanId = (n: number) => `distribution_log:${U(n)}`;

/**
 * Pool repo fake: runs `onGet(n, id)` before the n-th `get` (all pools; `id` is the pool asked
 * for), to race a write between two reads. Prefer counting per `id` over the global `n`.
 */
export function racingPoolRepo(
	real: BulkReturnPoolV3Repository,
	onGet: (n: number, id: string) => Promise<void>
): BulkReturnPoolV3Repository {
	let n = 0;
	return {
		create: (p) => real.create(p),
		get: async (id) => {
			n++;
			await onGet(n, id);
			return real.get(id);
		},
		list: () => real.list(),
		listWithSkipped: () => real.listWithSkipped(),
		update: (p) => real.update(p),
		mutateCAS: (id, m) => real.mutateCAS(id, m)
	};
}

export const fullInput = (pool: BulkReturnPoolV3): ReceiveBulkReturnPoolInput => ({
	items: (pool.items_summary ?? []).map((row) => ({
		item_id: row.item_id,
		received_qty: row.qty
	}))
});

/**
 * Resets the in-memory couch and builds fresh repos, deps and helpers bound to them. Call it from
 * `beforeEach` (the operation counter restarts at 1000 on every call).
 */
export function createBulkReturnPoolV3Fixture(couch: InMemoryCouch) {
	couch.reset();
	let opCounter = 1000;
	const nextOp = () => U(++opCounter);
	const poolRepo = new BulkReturnPoolV3RemoteRepository('SH001');
	const eventRepo = new BulkReturnEventRemoteRepository('SH001');
	const logRepo = new DistributionLogRemoteRepository('SH001');
	const operationsRepo = new OperationsRemoteRepository('shelter_sh001');
	const deps: BulkReturnPoolV3WorkflowDependencies = {
		poolRepo,
		eventRepo,
		logRepo,
		operationsRepo,
		catalogRepo: catalogOf(items),
		endpointStore: { active: 'central', isWritable: true }
	};

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

	const lockPool = (poolId: string) =>
		poolRepo.mutateCAS(poolId, (cur) => ({
			...cur,
			lock: { op: 'SUBMIT', op_id: U(900), locked_at: now(), locked_by: 'user:x' }
		}));

	/** A log repo that runs `afterList` right after the returner's loans were listed (allocation). */
	function driftingLogRepo(afterList: () => Promise<unknown>): DistributionLogRepository {
		return {
			create: (i, c) => logRepo.create(i, c),
			get: (id) => logRepo.get(id),
			getMany: (ids) => logRepo.getMany(ids),
			list: async (f) => {
				const loans = await logRepo.list(f);
				await afterList();
				return loans;
			},
			listWithSkipped: async (f) => {
				const found = await logRepo.listWithSkipped(f);
				await afterList();
				return found;
			},
			mutateLogCAS: (id, m, o) => logRepo.mutateLogCAS(id, m, o),
			recordReturn: (id, i, c) => logRepo.recordReturn(id, i, c),
			recordClear: (id, i, c) => logRepo.recordClear(id, i, c),
			recordVoid: (id, c, n) => logRepo.recordVoid(id, c, n)
		};
	}

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

	const receive = (
		poolId: string,
		input: ReceiveBulkReturnPoolInput,
		ctx = mgr,
		d = deps,
		op = nextOp()
	) => receiveBulkReturnPool(poolId, input, op, ctx, d);

	return {
		poolRepo,
		eventRepo,
		logRepo,
		operationsRepo,
		deps,
		nextOp,
		openPool,
		seedLoan,
		add,
		entryDocCount,
		lockPool,
		driftingLogRepo,
		ledgerKeys,
		balanceOf,
		submittedPool,
		receive
	};
}

export type BulkReturnPoolV3Fixture = ReturnType<typeof createBulkReturnPoolV3Fixture>;
