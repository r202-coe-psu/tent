// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupplyItem } from '$lib/features/supply';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

const mockGetItem = vi.fn<(itemId: string) => Promise<SupplyItem | null>>();
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: mockGetItem })
}));

// ---- in-memory CouchDB ---------------------------------------------------------------------

type Doc = { _id: string; _rev?: string } & Record<string, unknown>;
const docs = new Map<string, Doc>();
const failingBulkIds = new Set<string>();
let loseBulkResponse = false;
const bulkCalls: string[][] = [];

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return {
		...actual,
		createRemoteRepository: () => ({
			async get(id: string) {
				const found = docs.get(id);
				return found ? clone(found) : null;
			},
			async allByType(type: string, guard: (d: unknown) => boolean): Promise<unknown[]> {
				return [...docs.values()]
					.filter((d) => d._id.startsWith(`${type}:`) && guard(d))
					.map(clone);
			}
		})
	};
});

vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		getDoc: async (_db: string, id: string) => (docs.has(id) ? clone(docs.get(id)) : null),
		bulkDocsDetailed: async (_db: string, batch: Doc[]) => {
			bulkCalls.push(batch.map((d) => d._id));
			const outcomes = batch.map((doc) => {
				if (failingBulkIds.has(doc._id)) {
					return {
						id: doc._id,
						ok: false as const,
						status: 403,
						error: 'forbidden',
						reason: 'injected row failure'
					};
				}
				if (docs.has(doc._id)) {
					return {
						id: doc._id,
						ok: false as const,
						status: 409,
						error: 'conflict',
						reason: 'Document update conflict.'
					};
				}
				docs.set(doc._id, { ...clone(doc), _rev: '1-t' });
				return { id: doc._id, ok: true as const, rev: '1-t' };
			});
			if (loseBulkResponse) throw new Error('network dropped after the write');
			return outcomes;
		}
	};
});

import { OperationsRemoteRepository } from './operations.remote';
import {
	isStockLedger,
	stockBalance,
	createStockLedger,
	type StockLedger
} from '../domain/operations';
import { buildCycleCountLots, planCycleCount, type CycleCountEntry } from '../domain/cycle-count';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'counter' };
const SHELF = { storage_point_id: 'sp-a', storage_zone: 'ชั้น A' };

function seed(item_id: string, qty: string, unit = 'kg') {
	const row = createStockLedger(
		{ item_id, qty, unit, reason: 'donation', ref_id: 'donation:d1', lot: SHELF },
		ctx
	);
	docs.set(row._id, clone(row) as unknown as Doc);
}

function ledgerRows(): StockLedger[] {
	return ([...docs.values()] as unknown[]).filter(isStockLedger);
}

/** The count a walker starts from the current ledger, keyed with `counted[item_id]`. */
function keyedEntries(counted: Record<string, string>): CycleCountEntry[] {
	return buildCycleCountLots(ledgerRows()).map((lot) => ({
		...lot,
		counted_qty: counted[lot.item_id] ?? ''
	}));
}

let repo: OperationsRemoteRepository;

beforeEach(() => {
	docs.clear();
	failingBulkIds.clear();
	bulkCalls.length = 0;
	loseBulkResponse = false;
	mockGetItem.mockReset();
	mockGetItem.mockImplementation(async () => ({ unit: 'kg' }) as SupplyItem);
	repo = new OperationsRemoteRepository('shelter_sh001');
	seed('item:rice', '10');
	seed('item:oil', '6');
	seed('item:salt', '4');
});

describe('applyCycleCount (#347)', () => {
	it('writes one count_mismatch adjust per differing lot in a single bulk write', async () => {
		const submission = planCycleCount(
			keyedEntries({ 'item:rice': '8', 'item:oil': '6', 'item:salt': '5' }),
			'count-1'
		);
		const result = await repo.applyCycleCount(submission, ctx);

		expect(result.complete).toBe(true);
		expect(bulkCalls).toHaveLength(1);
		const adjusts = ledgerRows().filter((r) => r.reason === 'adjust');
		expect(adjusts).toHaveLength(2); // oil matched → no row
		expect(adjusts.every((r) => r.adjust_reason === 'count_mismatch')).toBe(true);
		const balance = stockBalance(ledgerRows());
		expect(balance.get('item:rice')).toBe('8');
		expect(balance.get('item:salt')).toBe('5');
		expect(balance.get('item:oil')).toBe('6');
	});

	it('re-sending the same count writes nothing twice', async () => {
		const submission = planCycleCount(keyedEntries({ 'item:rice': '8' }), 'count-1');
		await repo.applyCycleCount(submission, ctx);
		const again = await repo.applyCycleCount(submission, ctx);

		expect(again.complete).toBe(true);
		expect(again.lines.every((l) => l.state === 'saved')).toBe(true);
		expect(ledgerRows().filter((r) => r.reason === 'adjust')).toHaveLength(1);
		expect(bulkCalls).toHaveLength(1);
	});

	it('returns a partial write instead of throwing, and a retry sends only the missing row', async () => {
		const submission = planCycleCount(
			keyedEntries({ 'item:rice': '8', 'item:salt': '5' }),
			'count-1'
		);
		const saltRow = submission.lines.find((l) => l.item_id === 'item:salt')!;
		// the row id is derived inside; fail it by id after deriving the same way
		const { deriveCycleCountLineId } = await import('../domain/cycle-count');
		failingBulkIds.add(await deriveCycleCountLineId('count-1', saltRow.item_id, saltRow.lot_key));

		const first = await repo.applyCycleCount(submission, ctx);
		expect(first.complete).toBe(false);
		expect(first.lines.map((l) => l.state).sort()).toEqual(['failed', 'saved']);
		expect(first.lines.find((l) => l.state === 'failed')?.error).toContain('forbidden');

		failingBulkIds.clear();
		const retry = await repo.applyCycleCount(submission, ctx);
		expect(retry.complete).toBe(true);
		expect(bulkCalls.at(-1)).toHaveLength(1);
		expect(ledgerRows().filter((r) => r.reason === 'adjust')).toHaveLength(2);
	});

	it('treats a lost bulk response as saved when the rows did land', async () => {
		loseBulkResponse = true;
		const result = await repo.applyCycleCount(
			planCycleCount(keyedEntries({ 'item:rice': '8' }), 'count-1'),
			ctx
		);
		expect(result.complete).toBe(true);
	});

	it('refuses a write-off larger than the balance before writing anything', async () => {
		const submission = planCycleCount(keyedEntries({ 'item:rice': '8', 'item:salt': '5' }), 'c');
		// the shelf lost stock between the walk and the save
		seed('item:rice', '-9');
		await expect(repo.applyCycleCount(submission, ctx)).rejects.toThrow(/Insufficient stock/);
		expect(bulkCalls).toHaveLength(0);
		expect(ledgerRows().filter((r) => r.reason === 'adjust')).toHaveLength(0);
	});

	it('refuses an unknown item or a unit mismatch before writing anything', async () => {
		const submission = planCycleCount(keyedEntries({ 'item:rice': '8', 'item:salt': '5' }), 'c');
		mockGetItem.mockImplementation(async (id) =>
			id === 'item:salt' ? ({ unit: 'ถุง' } as SupplyItem) : ({ unit: 'kg' } as SupplyItem)
		);
		await expect(repo.applyCycleCount(submission, ctx)).rejects.toThrow(/Unit mismatch/);
		mockGetItem.mockImplementation(async () => null);
		await expect(repo.applyCycleCount(submission, ctx)).rejects.toThrow(/Unknown item/);
		expect(bulkCalls).toHaveLength(0);
	});

	it('refuses an empty submission and a retry that disagrees with a recorded row', async () => {
		await expect(
			repo.applyCycleCount(planCycleCount(keyedEntries({ 'item:rice': '10' }), 'c'), ctx)
		).rejects.toThrow(/Nothing to record/);

		await repo.applyCycleCount(planCycleCount(keyedEntries({ 'item:rice': '8' }), 'count-1'), ctx);
		const [rice] = buildCycleCountLots(ledgerRows()).filter((l) => l.item_id === 'item:rice');
		const changed = planCycleCount([{ ...rice, system_qty: '10', counted_qty: '7' }], 'count-1');
		await expect(repo.applyCycleCount(changed, ctx)).rejects.toThrow(/cannot be changed/);
	});
});
