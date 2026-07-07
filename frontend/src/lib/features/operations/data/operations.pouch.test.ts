// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import type { SupplyItem } from '$lib/features/supply';

PouchDB.plugin(memory);

let testDb: PouchDB.Database;

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	shelterDb: () => testDb,
	getShelterDb: () => 'shelter_sh001'
}));

vi.mock('$lib/db/pouch', () => ({
	namedLocalDb: () => testDb
}));

const mockGetItem = vi.fn<() => Promise<SupplyItem | null>>();
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: mockGetItem })
}));

import { OperationsPouchRepository, assertReceiveAgainstCatalog } from './operations.pouch';
import { createReceiveEntry } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

describe('assertReceiveAgainstCatalog', () => {
	const entry = createReceiveEntry(
		{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: null },
		ctx
	);

	it('throws for a missing catalog item', () => {
		expect(() => assertReceiveAgainstCatalog(entry, null)).toThrow('Unknown item: item:rice');
	});

	it('throws on unit mismatch', () => {
		expect(() => assertReceiveAgainstCatalog(entry, { unit: 'bag' } as SupplyItem)).toThrow(
			'Unit mismatch for item item:rice: expected bag, got kg'
		);
	});

	it('throws when a perishable item is missing lot.expiry', () => {
		expect(() =>
			assertReceiveAgainstCatalog(entry, { unit: 'kg', perishable: true } as SupplyItem)
		).toThrow('Perishable item item:rice requires lot.expiry to be set');
	});

	it('passes for a matching, non-perishable item', () => {
		expect(() => assertReceiveAgainstCatalog(entry, { unit: 'kg' } as SupplyItem)).not.toThrow();
	});

	it('passes for a perishable item with lot.expiry set', () => {
		const perishableEntry = createReceiveEntry(
			{
				item_id: 'item:milk',
				qty: 5,
				unit: 'l',
				source: 'donation',
				ref_id: null,
				lot: { expiry: '2026-12-31T00:00:00Z' }
			},
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(perishableEntry, { unit: 'l', perishable: true } as SupplyItem)
		).not.toThrow();
	});
});

describe('OperationsPouchRepository', () => {
	let repo: OperationsPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-operations-${Math.random().toString(36).slice(2)}`, {
			adapter: 'memory'
		});
		repo = new OperationsPouchRepository();
	});

	it('persists a stock ledger entry and lists them', async () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 100,
				unit: 'kg',
				source: 'donation',
				ref_id: null
			},
			ctx
		);

		await repo.addLedgerEntry(entry);
		const list = await repo.listLedger();

		expect(list).toHaveLength(1);
		expect(list[0]._id).toBe(entry._id);
		expect(list[0].item_id).toBe('item:rice');
		expect(list[0].qty).toBe(100);
	});

	it('filters ledger entries by item ID', async () => {
		const entry1 = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 50,
				unit: 'kg',
				source: 'donation',
				ref_id: null
			},
			ctx
		);
		const entry2 = createReceiveEntry(
			{
				item_id: 'item:water',
				qty: 200,
				unit: 'bottle',
				source: 'donation',
				ref_id: 'donation:123'
			},
			ctx
		);

		await repo.addLedgerEntry(entry1);
		await repo.addLedgerEntry(entry2);

		const riceLedger = await repo.listLedgerByItem('item:rice');
		expect(riceLedger).toHaveLength(1);
		expect(riceLedger[0].item_id).toBe('item:rice');

		const waterLedger = await repo.listLedgerByItem('item:water');
		expect(waterLedger).toHaveLength(1);
		expect(waterLedger[0].item_id).toBe('item:water');
	});

	it('calculates the stock balance accurately', async () => {
		const entries = [
			createReceiveEntry(
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			),
			createReceiveEntry(
				{ item_id: 'item:water', qty: 50, unit: 'bottle', source: 'donation', ref_id: null },
				ctx
			),
			{
				_id: 'stock_ledger:01J20000000000000000000002',
				schema_v: 1,
				shelter_code: 'SH001',
				type: 'stock_ledger' as const,
				item_id: 'item:rice',
				qty: -30,
				unit: 'kg',
				reason: 'distribute' as const,
				ref_id: null,
				occurred_at: new Date().toISOString(),
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: 'tester'
			}
		];

		for (const entry of entries) {
			await repo.addLedgerEntry(entry);
		}

		const balance = await repo.getBalance();
		expect(balance.get('item:rice')).toBe(70);
		expect(balance.get('item:water')).toBe(50);
	});

	it('maintains correct balance under concurrent writes (T-11 DoD)', async () => {
		const writes = Array.from({ length: 10 }).map(() =>
			repo.addLedgerEntry(
				createReceiveEntry(
					{ item_id: 'item:concurrent', qty: 10, unit: 'box', source: 'donation' },
					ctx
				)
			)
		);
		await Promise.all(writes);

		const balance = await repo.getBalance();
		expect(balance.get('item:concurrent')).toBe(100);
	});

	describe('receiveStock', () => {
		beforeEach(() => {
			mockGetItem.mockReset();
		});

		it('throws for an unknown item_id', async () => {
			mockGetItem.mockResolvedValue(null);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:missing', qty: 10, unit: 'kg', source: 'donation', ref_id: null },
					ctx
				)
			).rejects.toThrow('Unknown item: item:missing');
		});

		it('throws on unit mismatch against the catalog item', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'bag', source: 'donation', ref_id: null },
					ctx
				)
			).rejects.toThrow('Unit mismatch for item item:rice: expected kg, got bag');
		});

		it('throws when a perishable item is missing lot.expiry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg', perishable: true } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: null },
					ctx
				)
			).rejects.toThrow('Perishable item item:rice requires lot.expiry to be set');
		});

		it('persists the ledger entry when the item exists and units match', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const result = await repo.receiveStock(
				{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			);

			expect(result.item_id).toBe('item:rice');
			const list = await repo.listLedger();
			expect(list).toHaveLength(1);
		});
	});
});

describe('OperationsPouchRepository.updateCampaign', () => {
	let repo: OperationsPouchRepository;

	beforeEach(() => {
		testDb = new PouchDB(`test-ops-${Math.random().toString(36).slice(2)}`, { adapter: 'memory' });
		repo = new OperationsPouchRepository();
	});

	it('should update campaign and create an audit log entry', async () => {
		const created = await repo.createCampaign(
			{
				title: 'น้ำดื่มและยารักษาโรค',
				needs: [{ item_id: 'item:water', qty_target: 100, unit: 'ขวด', status: 'open' }]
			},
			ctx
		);

		const updatedCampaign = {
			...created,
			title: 'น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)'
		};

		const auditInput = {
			action: 'manual_adjust' as const,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			ctx
		};

		const result = await repo.updateCampaign(updatedCampaign, auditInput);

		expect(result.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');
		const storedCampaign = await repo.getCampaign(created._id);
		expect(storedCampaign?.title).toBe('น้ำดื่มและยารักษาโรค (ด่วนพิเศษ)');

		const docs = await testDb.allDocs({ include_docs: true });
		const auditDocs = docs.rows
			.map((r) => r.doc as Record<string, unknown> | undefined)
			.filter((d): d is Record<string, unknown> & { type: string } => {
				return d !== undefined && d !== null && typeof d === 'object' && d.type === 'audit';
			});

		expect(auditDocs).toHaveLength(1);
		expect(auditDocs[0]).toMatchObject({
			action: 'manual_adjust',
			target_type: 'donation_campaign',
			target_id: created._id,
			reason: 'อัปเดตชื่อแคมเปญเพื่อความชัดเจน',
			created_by: 'tester'
		});
	});
});
