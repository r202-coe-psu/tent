// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';
import type { SupplyItem } from '$lib/features/supply';
import { isAuditEntry } from '$lib/features/shared';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001',
	getShelterCode: () => 'SH001'
}));

const mockGetItem = vi.fn<() => Promise<SupplyItem | null>>();
vi.mock('$lib/features/supply', () => ({
	supplyRepository: () => ({ getItem: mockGetItem })
}));

let memoryRepo = createInMemoryRepository();
vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: () => memoryRepo };
});

import { OperationsRemoteRepository, assertReceiveAgainstCatalog } from './operations.remote';
import { createReceiveEntry } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

const otherShelterCtx: AuthorContext = { shelterCode: 'SH002', createdBy: 'sh002-tester' };

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

describe('OperationsRemoteRepository', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new OperationsRemoteRepository('shelter_sh001');
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
		expect(list[0].qty).toBe('100');
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
				schema_v: 2,
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
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 50, unit: 'bar', source: 'donation', ref_id: null },
				ctx
			);

			const distributeEntry = await repo.distributeStock(
				{ item_id: 'item:soap', qty: 20, unit: 'bar', ref_id: null, note: 'Tent A' },
				ctx
			);

			expect(distributeEntry.item_id).toBe('item:soap');
			expect(distributeEntry.qty).toBe('-20');
			expect(distributeEntry.reason).toBe('distribute');
			expect(distributeEntry.lot?.note).toBe('Tent A');

			const balance = await repo.getBalance();
			expect(balance.get('item:soap')).toBe('30');
		});

		it('throws an error if attempting to distribute more than available stock', async () => {
			mockGetItem.mockResolvedValue({ unit: 'bar' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'donation', ref_id: null },
				ctx
			);

			await expect(
				repo.distributeStock({ item_id: 'item:soap', qty: 15, unit: 'bar', ref_id: null }, ctx)
			).rejects.toThrow('Insufficient stock');
		});

		it('throws an error if attempting to distribute stock for item with zero balance', async () => {
			await expect(
				repo.distributeStock({ item_id: 'item:unknown', qty: 5, unit: 'bar', ref_id: null }, ctx)
			).rejects.toThrow('Insufficient stock');
		});
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

	describe('Inter-shelter Transfer methods', () => {
		it('creates a transfer in requested status', async () => {
			const transfer = await repo.createTransfer(
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 20, unit: 'kg' }]
				},
				ctx
			);

			expect(transfer.status).toBe('requested');
			expect(transfer.from_shelter).toBe('SH001');
			expect(transfer.to_shelter).toBe('SH002');
		});

		it('dispatches a transfer, deducts stock, and persists an outbound ledger entry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			);

			const transfer = await repo.createTransfer(
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 30, unit: 'kg' }]
				},
				ctx
			);

			const { transfer: dispatched, ledgers } = await repo.dispatchTransfer(transfer, ctx);

			expect(dispatched.status).toBe('shipped');
			expect(ledgers).toHaveLength(1);
			expect(ledgers[0].reason).toBe('transfer_out');
			expect(ledgers[0].qty).toBe('-30');

			const balance = await repo.getBalance();
			expect(balance.get('item:rice')).toBe('70');
		});

		it('throws and does not write anything when dispatching with insufficient stock', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:rice', qty: 10, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			);

			const transfer = await repo.createTransfer(
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 50, unit: 'kg' }]
				},
				ctx
			);

			await expect(repo.dispatchTransfer(transfer, ctx)).rejects.toThrow('Insufficient stock');

			const balance = await repo.getBalance();
			expect(balance.get('item:rice')).toBe('10');
			const ledger = await repo.listLedger();
			expect(ledger.filter((l) => l.reason === 'transfer_out')).toHaveLength(0);
		});

		it('receives a transfer completely and credits stock via an inbound ledger entry', async () => {
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			);
			const transfer = await repo.createTransfer(
				{
					from_shelter: 'SH001',
					to_shelter: 'SH002',
					items: [{ item_id: 'item:rice', qty: 40, unit: 'kg' }]
				},
				ctx
			);
			const { transfer: dispatched } = await repo.dispatchTransfer(transfer, ctx);

			const { transfer: received, ledgers } = await repo.receiveTransfer(
				dispatched,
				[{ item_id: 'item:rice', qty: 40 }],
				otherShelterCtx
			);

			expect(received.status).toBe('received');
			expect(received.items[0].received_qty).toBe('40');
			expect(ledgers).toHaveLength(1);
			expect(ledgers[0].reason).toBe('transfer_in');
			expect(ledgers[0].qty).toBe('40');

			const balance = await repo.getBalance();
			expect(balance.get('item:rice')).toBe('100');
		});

		it('lists only shipped transfers addressed to the current shelter', async () => {
			// getShelterCode() is mocked to 'SH001' for the whole file, so
			// listIncomingTransfers() on this repo instance represents SH001's inbox.
			mockGetItem.mockResolvedValue({ unit: 'kg' } as SupplyItem);
			await repo.receiveStock(
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'donation', ref_id: null },
				ctx
			);

			// Requested but not yet shipped — should be excluded.
			await repo.createTransfer(
				{
					from_shelter: 'SH002',
					to_shelter: 'SH001',
					items: [{ item_id: 'item:rice', qty: 10, unit: 'kg' }]
				},
				otherShelterCtx
			);

			// Shipped to SH001 (the current shelter under mock) — should be included.
			const toSH001 = await repo.createTransfer(
				{
					from_shelter: 'SH002',
					to_shelter: 'SH001',
					items: [{ item_id: 'item:rice', qty: 20, unit: 'kg' }]
				},
				otherShelterCtx
			);
			await repo.dispatchTransfer(toSH001, otherShelterCtx);

			// Shipped to a different shelter (SH003) — should be excluded.
			const toSH003 = await repo.createTransfer(
				{
					from_shelter: 'SH002',
					to_shelter: 'SH003',
					items: [{ item_id: 'item:rice', qty: 15, unit: 'kg' }]
				},
				otherShelterCtx
			);
			await repo.dispatchTransfer(toSH003, otherShelterCtx);

			const incoming = await repo.listIncomingTransfers();

			expect(incoming).toHaveLength(1);
			expect(incoming[0].to_shelter).toBe('SH001');
			expect(incoming[0].status).toBe('shipped');
		});
	});
});

describe('OperationsRemoteRepository.updateCampaign', () => {
	let repo: OperationsRemoteRepository;

	beforeEach(() => {
		memoryRepo = createInMemoryRepository();
		repo = new OperationsRemoteRepository('shelter_sh001');
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
