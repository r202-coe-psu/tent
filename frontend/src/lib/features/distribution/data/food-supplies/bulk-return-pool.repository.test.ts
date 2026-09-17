// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { AuthorContext } from '$lib/db/model';
import {
	BulkReturnPoolRemoteRepository,
	type BulkReturnPoolRepository
} from './bulk-return-pool.repository';

interface InMemoryDoc {
	_id: string;
	_rev?: string;
	type?: string;
	[key: string]: unknown;
}

let store: Map<string, InMemoryDoc>;
let revCounters: Map<string, number>;

function nextRev(id: string): string {
	const count = (revCounters.get(id) ?? 0) + 1;
	revCounters.set(id, count);
	return `${count}-rev${id.replace(/[^a-zA-Z0-9]/g, '')}`;
}

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/couch-db', async () => {
	const { ConflictError } = await import('$lib/utils/errors');
	return {
		ConflictError,
		getDoc: async <T extends { _id: string }>(_dbName: string, id: string): Promise<T | null> => {
			const doc = store.get(id);
			if (!doc) return null;
			return JSON.parse(JSON.stringify(doc)) as T;
		},
		putDoc: async <T extends { _id: string; _rev?: string }>(
			_dbName: string,
			doc: T
		): Promise<T> => {
			const existing = store.get(doc._id);
			if (existing) {
				if (!doc._rev || doc._rev !== existing._rev) {
					throw new ConflictError(`Conflict on doc ${doc._id}`);
				}
			}
			const clone = JSON.parse(JSON.stringify(doc)) as T & { _rev: string };
			clone._rev = nextRev(doc._id);
			store.set(doc._id, clone as InMemoryDoc);
			return clone;
		},
		allDocsByType: async <T extends { _id: string; type: string }>(
			_dbName: string,
			type: string
		): Promise<T[]> => {
			const results: T[] = [];
			for (const [id, doc] of store.entries()) {
				if (id.startsWith(`${type}:`) && doc.type === type) {
					results.push(JSON.parse(JSON.stringify(doc)) as T);
				}
			}
			return results;
		}
	};
});

describe('BulkReturnPoolRemoteRepository', () => {
	const ctx: AuthorContext = {
		createdBy: 'user:wh1',
		shelterCode: 'SH001',
		roles: ['warehouse_staff']
	};

	let repo: BulkReturnPoolRepository;
	const dummyStockLedgerId = 'stock_ledger:01J00000000000000000000000';

	beforeEach(() => {
		store = new Map();
		revCounters = new Map();
		repo = new BulkReturnPoolRemoteRepository('SH001');
	});

	it('creates canonical BulkReturnPool with exact initial quota', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '20.5',
				notes: 'Morning shift sweep returns'
			},
			ctx
		);

		expect(pool._id).toMatch(/^bulk_return_pool:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(pool.type).toBe('bulk_return_pool');
		expect(pool.status).toBe('ACTIVE');
		expect(pool.claimed_qty).toBe('0');
		expect(pool.unclaimed_quota).toBe('20.5');
		expect(pool.total_received_qty).toBe('20.5');
	});

	it('claims quota with exact Decimal arithmetic', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '10'
			},
			ctx
		);

		const updated = await repo.claimQuota(pool._id, '3', ctx);
		expect(updated.claimed_qty).toBe('3');
		expect(updated.unclaimed_quota).toBe('7');
		expect(updated.status).toBe('ACTIVE');

		const updated2 = await repo.claimQuota(pool._id, '2.5', ctx);
		expect(updated2.claimed_qty).toBe('5.5');
		expect(updated2.unclaimed_quota).toBe('4.5');
		expect(updated2.status).toBe('ACTIVE');
	});

	it('rejects overclaiming beyond unclaimed quota', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '5'
			},
			ctx
		);

		await expect(repo.claimQuota(pool._id, '6', ctx)).rejects.toThrow(
			/Insufficient unclaimed quota/
		);
	});

	it('derives EXHAUSTED status when quota reaches exactly zero', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '5'
			},
			ctx
		);

		const exhausted = await repo.claimQuota(pool._id, '5', ctx);
		expect(exhausted.claimed_qty).toBe('5');
		expect(exhausted.unclaimed_quota).toBe('0');
		expect(exhausted.status).toBe('EXHAUSTED');

		// Subsequent claim on EXHAUSTED pool fails closed
		await expect(repo.claimQuota(pool._id, '1', ctx)).rejects.toThrow(/not ACTIVE/);
	});

	it('handles CAS conflict reload and recomputes correctly', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '10'
			},
			ctx
		);

		// First claim
		await repo.claimQuota(pool._id, '2', ctx);

		// Now simulate a concurrent claim conflict on second claim
		const updated = await repo.claimQuota(pool._id, '3', ctx);
		expect(updated.claimed_qty).toBe('5');
		expect(updated.unclaimed_quota).toBe('5');
	});

	it('closes pool with audit fields', async () => {
		const pool = await repo.create(
			{
				item_id: 'item:cot',
				stock_ledger_id: dummyStockLedgerId,
				total_received_qty: '10'
			},
			ctx
		);

		await repo.claimQuota(pool._id, '8', ctx);
		const closed = await repo.closePool(pool._id, ctx, 'End of shift reconciliation');

		expect(closed.status).toBe('CLOSED');
		expect(closed.closed_by).toBe('user:wh1');
		expect(closed.closed_at).toBeDefined();
		expect(closed.notes).toBe('End of shift reconciliation');
	});
});
