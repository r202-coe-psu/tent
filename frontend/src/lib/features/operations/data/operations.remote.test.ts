// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { SupplyItem } from '$lib/features/supply';
import type { ItemMaster } from '$lib/features/catalog';
import { isAuditEntry } from '$lib/features/shared';

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

import type { Repository } from '$lib/db/repository';
import { ConflictError } from '$lib/utils/errors';

const couchDocs = new Map<string, { _id: string; _rev?: string } & Record<string, unknown>>();

function mockPutDoc<T extends { _id: string; _rev?: string }>(doc: T, strict = false): T {
	const existing = couchDocs.get(doc._id);
	if (existing) {
		if (strict && (!doc._rev || doc._rev !== existing._rev)) {
			throw new ConflictError(doc._id);
		}
		const revNum = existing._rev ? parseInt(existing._rev.split('-')[0], 10) + 1 : 2;
		const saved = { ...doc, _rev: `${revNum}-mockrev` } as T;
		couchDocs.set(doc._id, JSON.parse(JSON.stringify(saved)));
		return JSON.parse(JSON.stringify(saved));
	} else {
		if (strict && doc._rev) {
			throw new Error(`Cannot create new document ${doc._id} with existing rev`);
		}
		const saved = { ...doc, _rev: '1-mockrev' } as T;
		couchDocs.set(doc._id, JSON.parse(JSON.stringify(saved)));
		return JSON.parse(JSON.stringify(saved));
	}
}

function mockGetDoc<T extends { _id: string }>(id: string): T | null {
	const found = couchDocs.get(id);
	if (!found) return null;
	return JSON.parse(JSON.stringify(found)) as T;
}

let memoryRepo: Repository = {
	async put<T extends { _id: string }>(doc: T): Promise<T> {
		return mockPutDoc(doc, false);
	},
	async get<T extends { _id: string }>(id: string): Promise<T | null> {
		return mockGetDoc<T>(id);
	},
	async remove(doc: { _id: string; _rev?: string }): Promise<void> {
		couchDocs.delete(doc._id);
	},
	async allByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T
	): Promise<T[]> {
		return [...couchDocs.values()].filter((d): d is T => d._id.startsWith(`${type}:`) && guard(d));
	},
	async pageByType<T extends { _id: string; type: string }>(
		type: string,
		guard: (d: unknown) => d is T,
		page: number,
		pageSize: number
	) {
		const matched = await this.allByType(type, guard);
		const total = matched.length;
		const totalPages = Math.max(1, Math.ceil(total / pageSize));
		const safePage = Math.max(1, Math.min(page, totalPages));
		const start = (safePage - 1) * pageSize;
		return {
			items: matched.slice(start, start + pageSize),
			total,
			page: safePage,
			pageSize,
			totalPages
		};
	},
	async find<T>(): Promise<T[]> {
		return [...couchDocs.values()] as unknown as T[];
	},
	async bulkDocs<T extends { _id: string; _rev?: string }>(docs: T[]): Promise<T[]> {
		const saved: T[] = [];
		for (const doc of docs) {
			const existing = mockGetDoc<T>(doc._id);
			if (!existing) {
				// CouchDB reports a conflict for a create carrying an _rev.
				saved.push(doc._rev ? doc : mockPutDoc(doc, false));
				continue;
			}
			if (!doc._rev || doc._rev !== existing._rev) {
				// bulkDocs returns per-document conflicts; the repository wrapper keeps
				// the original document for idempotent conflict-only batches.
				saved.push(doc);
				continue;
			}
			saved.push(mockPutDoc(doc, true));
		}
		return saved;
	}
};

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

vi.mock('$lib/db/couch-db', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/couch-db')>();
	return {
		...actual,
		getDoc: async <T extends { _id: string }>(_dbName: string, id: string) => mockGetDoc<T>(id),
		putDocStrict: async (_dbName: string, doc: { _id: string; _rev?: string }) =>
			mockPutDoc(doc, true),
		bulkDocs: async (_dbName: string, docs: { _id: string }[]) => {
			const saved = [];
			for (const doc of docs) saved.push(mockPutDoc(doc, false));
			return saved;
		}
	};
});

import {
	OperationsRemoteRepository,
	assertReceiveAgainstCatalog,
	catalogItemRules
} from './operations.remote';
import {
	createReceiveEntry,
	createStockLedger,
	projectStockLotBalances
} from '../domain/operations';
import { createStockLotReservation, makeLotReservationDocId } from '$lib/features/distribution';
import { rankLotsForIssue } from '../domain/lot-priority';
import { planLotSplit } from '../domain/lot-split';
import { distributeAcrossLots } from '../application/distribute-across-lots';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

// CR-055 R2: a 'donation' receipt must point at a real donation doc, so fixtures
// that only need stock on hand still have to name one.
const DONATION_REF = 'donation:01JFIXTUREDONATION';

// Ticket-era canonical distribute reference requires requisition_ticket: (CR-121 / schema §2.1)
const DISTRIBUTION_BATCH_REF = 'requisition_ticket:01JFIXTURETICKET';

describe('assertReceiveAgainstCatalog', () => {
	const entry = createReceiveEntry(
		{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
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

	// CR-013 transition: the `catalog` DB also holds `item_master:{ulid}` docs, whose
	// stock unit is `base_unit`. Reading the bare `unit` field failed every receipt
	// for one with `expected undefined, got <unit>`.
	it('resolves an item_master unit from base_unit', () => {
		const masterEntry = createReceiveEntry(
			{
				item_id: 'item_master:01M0Y3R8JEJBW4HB8E9C4KX5N',
				qty: 30,
				unit: 'เม็ด',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);
		const master = { type: 'item_master', base_unit: 'เม็ด' } as unknown as ItemMaster;

		expect(() => assertReceiveAgainstCatalog(masterEntry, master)).not.toThrow();
		expect(() =>
			assertReceiveAgainstCatalog(masterEntry, {
				type: 'item_master',
				base_unit: 'แผง'
			} as unknown as ItemMaster)
		).toThrow(
			'Unit mismatch for item item_master:01M0Y3R8JEJBW4HB8E9C4KX5N: expected แผง, got เม็ด'
		);
	});

	it('falls back to the legacy `unit` field on an item_master without base_unit', () => {
		const masterEntry = createReceiveEntry(
			{
				item_id: 'item_master:legacy',
				qty: 1,
				unit: 'ขวด',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(masterEntry, {
				type: 'item_master',
				unit: 'ขวด'
			} as unknown as ItemMaster)
		).not.toThrow();
	});

	// CR-143 §D (FR-D1): an item_master has no `perishable` flag, so the rule is derived.
	describe('item_master expiry requirement (CR-143 §D)', () => {
		const masterEntry = (expiry?: string) =>
			createReceiveEntry(
				{
					item_id: 'item_master:milk',
					qty: 1,
					unit: 'l',
					source: 'donation',
					ref_id: DONATION_REF,
					...(expiry ? { lot: { expiry } } : {})
				},
				ctx
			);
		const master = (extra: Record<string, unknown>) =>
			({ type: 'item_master', base_unit: 'l', ...extra }) as unknown as ItemMaster;

		it('AC-D1: rejects a CHILLED item received without lot.expiry', () => {
			expect(() =>
				assertReceiveAgainstCatalog(masterEntry(), master({ storage_type: 'CHILLED' }))
			).toThrow('requires lot.expiry to be set');
			expect(() =>
				assertReceiveAgainstCatalog(masterEntry(), master({ storage_type: 'FROZEN' }))
			).toThrow('requires lot.expiry to be set');
		});

		it('rejects an item with shelf_life_days received without lot.expiry', () => {
			expect(() =>
				assertReceiveAgainstCatalog(
					masterEntry(),
					master({ storage_type: 'DRY', shelf_life_days: 180 })
				)
			).toThrow('requires lot.expiry to be set');
		});

		it('AC-D2: never demands lot.expiry for a DRY item with no shelf life', () => {
			expect(() =>
				assertReceiveAgainstCatalog(masterEntry(), master({ storage_type: 'DRY' }))
			).not.toThrow();
			expect(() => assertReceiveAgainstCatalog(masterEntry(), master({}))).not.toThrow();
		});

		it('accepts a CHILLED item once lot.expiry is supplied', () => {
			expect(() =>
				assertReceiveAgainstCatalog(masterEntry('2026-12-31'), master({ storage_type: 'CHILLED' }))
			).not.toThrow();
		});

		it('catalogItemRules reports the derived requirement for both shapes', () => {
			expect(catalogItemRules(master({ storage_type: 'CHILLED' })).requiresExpiry).toBe(true);
			expect(catalogItemRules(master({ storage_type: 'DRY' })).requiresExpiry).toBe(false);
			expect(
				catalogItemRules({ type: 'supply_item', unit: 'l', perishable: true } as SupplyItem)
					.requiresExpiry
			).toBe(true);
		});
	});

	it('passes for a perishable item with lot.expiry set', () => {
		const perishableEntry = createReceiveEntry(
			{
				item_id: 'item:milk',
				qty: 5,
				unit: 'l',
				source: 'donation',
				ref_id: DONATION_REF,
				lot: { expiry: '2026-12-31T00:00:00Z' }
			},
			ctx
		);
		expect(() =>
			assertReceiveAgainstCatalog(perishableEntry, { unit: 'l', perishable: true } as SupplyItem)
		).not.toThrow();
	});
});

describe('OperationsRemoteRepository', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(() => {
		couchDocs.clear();
		repo = new OperationsRemoteRepository('shelter_sh001');
	});

	it('persists a stock ledger entry and lists them', async () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 100,
				unit: 'kg',
				source: 'donation',
				ref_id: DONATION_REF
			},
			ctx
		);

		await repo.addLedgerEntry(entry);
		const list = await repo.listLedger();

		expect(list).toHaveLength(1);
		expect(list[0]._id).toBe(entry._id);
		expect(list[0].item_id).toBe('item:rice');
		expect(list[0].qty).toBe('100');
	});

	it('filters ledger entries by item ID', async () => {
		const entry1 = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 50,
				unit: 'kg',
				source: 'donation',
				ref_id: DONATION_REF
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
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
				ctx
			),
			createReceiveEntry(
				{
					item_id: 'item:water',
					qty: 50,
					unit: 'bottle',
					source: 'donation',
					ref_id: DONATION_REF
				},
				ctx
			),
			{
				_id: 'stock_ledger:01J20000000000000000000002',
				schema_v: 3,
				shelter_code: 'SH001',
				type: 'stock_ledger' as const,
				item_id: 'item:rice',
				qty: '-30',
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
		expect(balance.get('item:rice')).toBe('70');
		expect(balance.get('item:water')).toBe('50');
	});

	describe('distributeStock', () => {
		it('distributes stock and reduces balance when sufficient stock exists', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 50, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			const distributeEntry = await repo.distributeStock(
				{
					item_id: 'item:soap',
					qty: 20,
					unit: 'bar',
					ref_id: DISTRIBUTION_BATCH_REF,
					lot_ref: inbound._id,
					note: 'Tent A'
				},
				ctx
			);

			expect(distributeEntry.item_id).toBe('item:soap');
			expect(distributeEntry.qty).toBe('-20');
			expect(distributeEntry.reason).toBe('distribute');
			expect(distributeEntry.ref_id).toBe(DISTRIBUTION_BATCH_REF);
			expect(distributeEntry.lot_ref).toBe(inbound._id);
			expect(distributeEntry.lot?.note).toBe('Tent A');

			const balance = await repo.getBalance();
			expect(balance.get('item:soap')).toBe('30');
		});

		it('throws an error if attempting to distribute more than available stock', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			await expect(
				repo.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 15,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				)
			).rejects.toThrow('Insufficient stock');
		});

		it('throws an error if attempting to distribute stock for item with zero balance', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			// Exhaust all 10 units from the lot so balance reaches 0
			await repo.distributeStock(
				{
					note: 'ครัวกลาง',
					item_id: 'item:soap',
					qty: 10,
					unit: 'bar',
					ref_id: DISTRIBUTION_BATCH_REF,
					lot_ref: inbound._id
				},
				ctx
			);

			const balance = await repo.getBalance();
			expect(balance.get('item:soap')).toBe('0');

			// Attempting to distribute 1 unit when balance is 0 fails with Insufficient stock
			await expect(
				repo.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 1,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				)
			).rejects.toThrow('Insufficient stock');
		});

		it('rejects an overdrawn selected lot even when another lot keeps the aggregate balance sufficient', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const firstLot = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 2, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			await expect(
				repo.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 5,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: firstLot._id
					},
					ctx
				)
			).rejects.toThrow('Insufficient stock in lot');

			expect(await repo.listLedger()).toHaveLength(2);
		});

		it('rejects a selected lot that belongs to another item or does not exist', async () => {
			mockGetItem.mockImplementation(async (itemId: string) =>
				itemId === 'item:soap' || itemId === 'item:water' ? ({ unit: 'bar' } as SupplyItem) : null
			);
			const waterLot = await repo.receiveStock(
				{ item_id: 'item:water', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			await expect(
				repo.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 1,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: waterLot._id
					},
					ctx
				)
			).rejects.toThrow('does not match item');

			await expect(
				repo.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 1,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: 'stock_ledger:missing-lot'
					},
					ctx
				)
			).rejects.toThrow('is not available');

			expect(await repo.listLedger()).toHaveLength(1);
		});

		it('recovers an abandoned direct-distribution claim before checking availability', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);
			const reservationId = await makeLotReservationDocId(inbound._id);
			const staleReservation = createStockLotReservation(
				{
					lot_ref: inbound._id,
					pending_claims: [
						{
							operation_id: 'op_dist_abandoned',
							request_id: 'distribution_request:abandoned',
							batch_id: 'distribution_batch:abandoned',
							item_id: 'item:soap',
							lot_ref: inbound._id,
							qty: '8',
							claimed_at: '2026-09-01T00:00:00.000Z'
						}
					]
				},
				reservationId.slice('stock_lot_reservation:'.length),
				ctx
			);
			mockPutDoc(staleReservation);

			await repo.distributeStock(
				{
					note: 'ครัวกลาง',
					item_id: 'item:soap',
					qty: 5,
					unit: 'bar',
					ref_id: DISTRIBUTION_BATCH_REF,
					lot_ref: inbound._id
				},
				ctx
			);

			expect(
				mockGetDoc<{ _id: string; pending_claims: unknown[] }>(reservationId)?.pending_claims
			).toEqual([]);
			expect((await repo.getBalance()).get('item:soap')).toBe('5');
		});

		it('serializes concurrent distributions for the same lot across multiple clients and never creates a negative lot balance', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			// Simulate two distinct clients / repository instances communicating with the same CouchDB
			const clientRepoA = new OperationsRemoteRepository('shelter_sh001');
			const clientRepoB = new OperationsRemoteRepository('shelter_sh001');

			const results = await Promise.allSettled([
				clientRepoA.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 7,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				),
				clientRepoB.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 7,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				)
			]);

			expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
			expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
			expect(await repo.getBalance()).toEqual(new Map([['item:soap', '3']]));
			expect(projectStockLotBalances(await repo.listLedger())).toEqual([
				expect.objectContaining({ lot_ref: inbound._id, item_id: 'item:soap', qty: '3' })
			]);
		});

		it('allows concurrent distributions across multiple clients when total quantity does not exceed lot balance', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			const clientRepoA = new OperationsRemoteRepository('shelter_sh001');
			const clientRepoB = new OperationsRemoteRepository('shelter_sh001');

			const results = await Promise.allSettled([
				clientRepoA.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 4,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				),
				clientRepoB.distributeStock(
					{
						note: 'ครัวกลาง',
						item_id: 'item:soap',
						qty: 4,
						unit: 'bar',
						ref_id: DISTRIBUTION_BATCH_REF,
						lot_ref: inbound._id
					},
					ctx
				)
			]);

			expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
			expect(await repo.getBalance()).toEqual(new Map([['item:soap', '2']]));
			expect(projectStockLotBalances(await repo.listLedger())).toEqual([
				expect.objectContaining({ lot_ref: inbound._id, item_id: 'item:soap', qty: '2' })
			]);
		});
	});

	describe('distribute across lots (CR-143 FR-A7–A9, AC-A5)', () => {
		const DAY = 86_400_000;
		const daysFromNow = (d: number) => new Date(Date.now() + d * DAY).toISOString();

		async function receiveLots(quantities: number[]) {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			const inbound = [];
			for (const [i, qty] of quantities.entries()) {
				// distinct, non-urgent expiries so the priority order is L1, L2, L3
				inbound.push(
					await repo.receiveStock(
						{
							item_id: 'item:soap',
							qty,
							unit: 'bar',
							source: 'donation',
							ref_id: DONATION_REF,
							lot: { expiry: daysFromNow(30 + i * 10) }
						},
						ctx
					)
				);
			}
			return inbound;
		}

		async function planFor(qty: string) {
			const lots = projectStockLotBalances(await repo.listLedger());
			const ranked = rankLotsForIssue(lots, undefined, Date.now(), { excludeExpired: true });
			return planLotSplit(ranked, qty, Date.now());
		}

		it('AC-A5: 30 from lots 6 / 20 / 16 writes 3 distribute rows 6 / 20 / 4 on one ref_id', async () => {
			const [l1, l2, l3] = await receiveLots([6, 20, 16]);
			const plan = await planFor('30');

			const result = await distributeAcrossLots(
				repo,
				{
					note: 'ครัวกลาง',
					allocations: plan.allocations,
					item_id: 'item:soap',
					ref_id: DISTRIBUTION_BATCH_REF
				},
				ctx
			);

			expect(result.complete).toBe(true);
			const rows = (await repo.listLedger()).filter((e) => e.reason === 'distribute');
			expect(rows).toHaveLength(3);
			expect(rows.map((e) => [e.lot_ref, e.qty])).toEqual([
				[l1._id, '-6'],
				[l2._id, '-20'],
				[l3._id, '-4']
			]);
			expect(new Set(rows.map((e) => e.ref_id))).toEqual(new Set([DISTRIBUTION_BATCH_REF]));
			expect((await repo.getBalance()).get('item:soap')).toBe('12');
			expect(
				projectStockLotBalances(await repo.listLedger()).map((l) => [l.lot_ref, l.qty])
			).toEqual([
				[l1._id, '0'],
				[l2._id, '0'],
				[l3._id, '12']
			]);
		});

		it('FR-A9: a failing row keeps the rows already written and reports the rest', async () => {
			const [l1, l2] = await receiveLots([6, 20, 16]);
			const plan = await planFor('30');
			// another writer drains lot 2 after the plan was made, so row 2 is refused
			await repo.distributeStock(
				{
					note: 'ครัวกลาง',
					item_id: 'item:soap',
					qty: 19,
					unit: 'bar',
					ref_id: 'requisition_ticket:01JOTHERWRITER',
					lot_ref: l2._id
				},
				ctx
			);

			const result = await distributeAcrossLots(
				repo,
				{
					note: 'ครัวกลาง',
					allocations: plan.allocations,
					item_id: 'item:soap',
					ref_id: DISTRIBUTION_BATCH_REF
				},
				ctx
			);

			expect(result.complete).toBe(false);
			expect(result.distributed.map((d) => [d.lot_ref, d.qty])).toEqual([[l1._id, '6']]);
			expect(result.distributedQty).toBe('6');
			expect(result.remainingQty).toBe('24');
			expect(result.failure?.lot_ref).toBe(l2._id);
			expect(result.failure?.message).toContain('Insufficient stock');
			const mine = (await repo.listLedger()).filter((e) => e.ref_id === DISTRIBUTION_BATCH_REF);
			expect(mine.map((e) => [e.lot_ref, e.qty])).toEqual([[l1._id, '-6']]);
		});
	});

	it('maintains correct balance under concurrent writes (T-11 DoD)', async () => {
		const writes = Array.from({ length: 10 }).map(() =>
			repo.addLedgerEntry(
				createReceiveEntry(
					{
						item_id: 'item:concurrent',
						qty: 10,
						unit: 'box',
						source: 'donation',
						ref_id: DONATION_REF
					},
					ctx
				)
			)
		);
		await Promise.all(writes);

		const balance = await repo.getBalance();
		expect(balance.get('item:concurrent')).toBe('100');
	});

	describe('receiveStock', () => {
		beforeEach(() => {
			mockGetItem.mockReset();
		});

		it('throws for an unknown item_id', async () => {
			mockGetItem.mockResolvedValue(null);

			await expect(
				repo.receiveStock(
					{
						item_id: 'item:missing',
						qty: 10,
						unit: 'kg',
						source: 'donation',
						ref_id: DONATION_REF
					},
					ctx
				)
			).rejects.toThrow('Unknown item: item:missing');
		});

		it('throws on unit mismatch against the catalog item', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'bag', source: 'donation', ref_id: DONATION_REF },
					ctx
				)
			).rejects.toThrow('Unit mismatch for item item:rice: expected kg, got bag');
		});

		it('throws when a perishable item is missing lot.expiry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg', perishable: true } as SupplyItem);

			await expect(
				repo.receiveStock(
					{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
					ctx
				)
			).rejects.toThrow('Perishable item item:rice requires lot.expiry to be set');
		});

		it('does not demand lot.expiry for any adjustment (CR-156 FR-D2d)', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg', perishable: true } as SupplyItem);
			await repo.receiveStock(
				{
					item_id: 'item:rice',
					qty: 10,
					unit: 'kg',
					source: 'donation',
					ref_id: DONATION_REF,
					lot: { expiry: '2027-01-01' }
				},
				ctx
			);

			const result = await repo.adjustStock(
				{ item_id: 'item:rice', qty: -2, unit: 'kg', source: 'adjust', reason: 'damaged' } as never,
				ctx
			);
			expect(result.qty).toBe('-2');

			const up = await repo.adjustStock(
				{ item_id: 'item:rice', qty: 2, unit: 'kg', source: 'adjust', reason: 'found' } as never,
				ctx
			);
			expect(up.qty).toBe('2');
		});

		it('persists the ledger entry when the item exists and units match', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const result = await repo.receiveStock(
				{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			expect(result.item_id).toBe('item:rice');
			const list = await repo.listLedger();
			expect(list).toHaveLength(1);
		});
	});

	// CR-143 §C — adjust_reason / note are persisted with schema_v 6 and a mixed
	// v5/v6 ledger still produces the right balance (AC-C1, AC-C3).
	describe('adjustStock (CR-143 §C)', () => {
		beforeEach(() => {
			mockGetItem.mockReset();
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
		});

		it('persists adjust_reason + note on a schema_v 6 row', async () => {
			await repo.receiveStock(
				{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: DONATION_REF },
				ctx
			);

			const entry = await repo.adjustStock(
				{
					item_id: 'item:rice',
					qty: '-4',
					unit: 'kg',
					adjust_reason: 'damaged',
					note: 'กระสอบฉีก',
					ref_id: null
				},
				ctx
			);

			expect(entry.schema_v).toBe(6);
			const stored = (await repo.listLedger()).find((e) => e._id === entry._id);
			expect(stored?.adjust_reason).toBe('damaged');
			expect(stored?.note).toBe('กระสอบฉีก');
			expect((await repo.getBalance()).get('item:rice')).toBe('6');
		});

		it('rejects a missing reason and writes nothing', async () => {
			await expect(
				repo.adjustStock({ item_id: 'item:rice', qty: '3', unit: 'kg', ref_id: null } as never, ctx)
			).rejects.toThrow();
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('rejects merge from the generic adjust path', async () => {
			await expect(
				repo.adjustStock(
					{
						item_id: 'item:rice',
						qty: '3',
						unit: 'kg',
						adjust_reason: 'merge',
						ref_id: null
					} as never,
					ctx
				)
			).rejects.toThrow();
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('sums a ledger that mixes schema_v 5 and 6 rows', async () => {
			// a pre-CR-143 adjust row as an older client persisted it
			await repo.addLedgerEntry({
				...createStockLedger(
					{ item_id: 'item:rice', qty: '10', unit: 'kg', reason: 'donation', ref_id: DONATION_REF },
					ctx
				),
				schema_v: 5 as never
			});
			await repo.adjustStock(
				{ item_id: 'item:rice', qty: '-3', unit: 'kg', adjust_reason: 'lost', ref_id: null },
				ctx
			);

			const ledger = await repo.listLedger();
			expect(ledger.map((e) => e.schema_v).sort()).toEqual([5, 6]);
			expect((await repo.getBalance()).get('item:rice')).toBe('7');
		});
	});

	// CR-055 R4 / D-1 — walk-in goods have no donation doc to point at, so one is
	// minted WITH the ledger row. The pairing is the point: a donation written on
	// its own would sit at `declared` forever if the receipt never followed, and
	// `calculateReserved` counts those as reserved stock with nothing to sweep them.
	describe('receiveWalkInDonation (CR-055 D-1)', () => {
		const walkIn = {
			donor: { name: 'ผู้ใจบุญ', phone: '0800000000', phone_hash: 'hash' },
			kind: 'items' as const,
			items: [{ item_id: 'item:rice', qty: 10, unit: 'kg' }],
			campaign_id: null,
			tracking_token_hash: 'tok'
		};
		const receive = {
			item_id: 'item:rice',
			qty: 10,
			unit: 'kg',
			source: 'donation' as const,
			ref_id: null
		};

		beforeEach(() => {
			mockGetItem.mockReset();
		});

		it('writes the donation and the ledger row that references it', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const { donation, entry } = await repo.receiveWalkInDonation(walkIn, receive, ctx);

			expect(donation._id).toMatch(/^donation:/);
			expect(donation.channel).toBe('walk_in');
			// the ledger points at the donation minted in the same call — this is
			// what makes the pair satisfy the R2 table
			expect(entry.reason).toBe('donation');
			expect(entry.ref_id).toBe(donation._id);

			expect(await repo.listDonations()).toHaveLength(1);
			expect(await repo.listLedger()).toHaveLength(1);
		});

		it('ignores any ref_id the caller passes — the fresh donation always wins', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			const { donation, entry } = await repo.receiveWalkInDonation(
				walkIn,
				{ ...receive, ref_id: 'donation:01JSOMEONEELSE' },
				ctx
			);

			expect(entry.ref_id).toBe(donation._id);
			expect(entry.ref_id).not.toBe('donation:01JSOMEONEELSE');
		});

		it('writes NOTHING when the catalog rejects the item', async () => {
			mockGetItem.mockResolvedValue(null);

			await expect(repo.receiveWalkInDonation(walkIn, receive, ctx)).rejects.toThrow(
				'Unknown item: item:rice'
			);

			// the guard runs before the write, so no orphan donation is left behind
			expect(await repo.listDonations()).toHaveLength(0);
			expect(await repo.listLedger()).toHaveLength(0);
		});

		it('receipts as a donation even if the caller names another source', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);

			// a walk-in IS a donation; a caller passing 'manual' would otherwise map
			// to reason 'adjust' and be rejected by R2 for carrying a ref_id
			const { entry } = await repo.receiveWalkInDonation(
				walkIn,
				{ ...receive, source: 'manual' as const },
				ctx
			);

			expect(entry.reason).toBe('donation');
		});

		it('writes NOTHING when the unit disagrees with the catalog', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bag' } as SupplyItem);

			await expect(repo.receiveWalkInDonation(walkIn, receive, ctx)).rejects.toThrow();
			expect(await repo.listDonations()).toHaveLength(0);
		});
	});
});

describe('OperationsRemoteRepository.updateCampaign', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(async () => {
		memoryRepo = createInMemoryRepository();
		repo = new OperationsRemoteRepository('shelter_sh001');
		mockGetItem.mockReset();
		mockGetItem.mockResolvedValue({
			_id: 'item:water',
			type: 'item',
			name: 'น้ำดื่ม',
			unit: 'bottle',
			perishable: false
		} as unknown as SupplyItem);
		await memoryRepo.put({
			_id: 'unit_of_measure:bottle',
			type: 'unit_of_measure',
			code: 'bottle',
			label_th: 'ขวด',
			label_en: 'bottle',
			dimension: 'count',
			deactivated: false
		});
	});

	it('should update campaign and create an audit log entry', async () => {
		const created = await repo.createCampaign(
			{
				title: 'น้ำดื่มและยารักษาโรค',
				needs: [{ item_id: 'item:water', qty_target: 100, unit: 'bottle', status: 'open' }]
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

		const auditDocs = await memoryRepo.allByType('audit', isAuditEntry);
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

describe('OperationsRemoteRepository — transfer via BFF (CR-059 Flow 1 / T-13)', () => {
	let repo: OperationsRemoteRepository;
	const fetchMock = vi.fn();

	const requestedTransfer = {
		_id: 'stock_transfer:01TRANSFER0000000000000000',
		type: 'stock_transfer',
		schema_v: 2,
		shelter_code: 'SH001',
		created_at: '2026-08-22T05:00:00.000Z',
		updated_at: '2026-08-22T05:00:00.000Z',
		created_by: 'Staff A',
		from_shelter: 'SH001',
		to_shelter: 'SH002',
		items: [{ item_id: 'item:rice', qty: '100', unit: 'kg' }],
		status: 'requested',
		timeline: { requested: { at: '2026-08-22T05:00:00.000Z', by: 'Staff A' } }
	};

	beforeEach(() => {
		vi.clearAllMocks();
		repo = new OperationsRemoteRepository();
		vi.stubGlobal('fetch', fetchMock);
	});

	it('creates a transfer via POST, not the shelter session repo', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => requestedTransfer
		});

		const doc = await repo.createTransfer({
			from_shelter: 'SH001',
			to_shelter: 'SH002',
			items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
		});

		expect(doc.status).toBe('requested');
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('/api/back-office/transfer?'),
			expect.objectContaining({ method: 'POST', credentials: 'include' })
		);
	});

	it('lists transfers scoped to the caller shelter', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => [requestedTransfer]
		});

		const list = await repo.listTransfers();
		expect(list).toHaveLength(1);
		expect(fetchMock).toHaveBeenCalledWith(
			expect.stringContaining('shelter_code=SH001'),
			expect.objectContaining({ credentials: 'include' })
		);
	});

	it('returns null for a 404 getTransfer', async () => {
		fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => null });
		expect(await repo.getTransfer('stock_transfer:missing')).toBeNull();
	});

	it('dispatches via PATCH to the transition endpoint with status shipped', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...requestedTransfer, status: 'shipped' })
		});

		const doc = await repo.dispatchTransfer(requestedTransfer._id, {
			driver_name: 'สมชาย ใจดี',
			vehicle_plate: 'กท 1234'
		});
		expect(doc.status).toBe('shipped');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain(
			`/api/back-office/transfer/${encodeURIComponent(requestedTransfer._id)}/transition?`
		);
		expect(init).toMatchObject({ method: 'PATCH', credentials: 'include' });
		// CR-089 FR-01 — driver/plate must reach the server, which is what enforces the rule.
		expect(JSON.parse(init.body)).toMatchObject({
			to: 'shipped',
			driver_name: 'สมชาย ใจดี',
			vehicle_plate: 'กท 1234'
		});
	});

	it('receives with receivedItems and notes forwarded in the request body', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...requestedTransfer, status: 'received' })
		});

		await repo.receiveTransfer(
			requestedTransfer._id,
			[{ item_id: 'item:rice', qty: 85 }],
			'15kg damaged in transit'
		);

		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toEqual({
			to: 'received',
			receivedItems: [{ item_id: 'item:rice', qty: 85 }],
			notes: '15kg damaged in transit'
		});
	});

	it('cancels via PATCH to the transition endpoint with status cancelled', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...requestedTransfer, status: 'cancelled' })
		});

		const doc = await repo.cancelTransfer(requestedTransfer._id, {
			cancel_reason: 'ปลายทางแจ้งว่าไม่ต้องการแล้ว'
		});
		expect(doc.status).toBe('cancelled');

		// CR-089 FR-03 — cancelling must carry a reason.
		const [, init] = fetchMock.mock.calls[0];
		expect(JSON.parse(init.body)).toMatchObject({
			to: 'cancelled',
			cancel_reason: 'ปลายทางแจ้งว่าไม่ต้องการแล้ว'
		});
	});

	it('disputes via PATCH to the transition endpoint with the reason in the body', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...requestedTransfer, status: 'disputed' })
		});

		const doc = await repo.disputeTransfer(requestedTransfer._id, {
			dispute_reason: 'สต็อกต้นทางไม่พอตามที่ขอ'
		});
		expect(doc.status).toBe('disputed');

		const [url, init] = fetchMock.mock.calls[0];
		expect(url).toContain(
			`/api/back-office/transfer/${encodeURIComponent(requestedTransfer._id)}/transition?`
		);
		expect(init).toMatchObject({ method: 'PATCH', credentials: 'include' });
		expect(JSON.parse(init.body)).toMatchObject({
			to: 'disputed',
			dispute_reason: 'สต็อกต้นทางไม่พอตามที่ขอ'
		});
	});

	it('resumes a disputed transfer back to requested with no extra field', async () => {
		fetchMock.mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ...requestedTransfer, status: 'requested' })
		});

		const doc = await repo.resumeTransfer(requestedTransfer._id);
		expect(doc.status).toBe('requested');

		// CR-089 FR-05 — resume carries no reason of its own; the last dispute_reason stands.
		const [, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);
		expect(body).toMatchObject({ to: 'requested' });
		expect(body).not.toHaveProperty('dispute_reason');
	});

	it('throws with the server error message on a failed create', async () => {
		fetchMock.mockResolvedValue({
			ok: false,
			status: 422,
			json: async () => ({ error: 'Cannot transfer to the same shelter' })
		});

		await expect(
			repo.createTransfer({
				from_shelter: 'SH001',
				to_shelter: 'SH001',
				items: [{ item_id: 'item:rice', qty: 100, unit: 'kg' }]
			})
		).rejects.toThrow('Cannot transfer to the same shelter');
	});
});
