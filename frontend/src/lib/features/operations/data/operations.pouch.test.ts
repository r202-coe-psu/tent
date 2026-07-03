// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import { OperationsPouchRepository } from './operations.pouch';
import { createReceiveEntry } from '../domain/operations';
import type { AuthorContext } from '$lib/db/model';

PouchDB.plugin(memory);

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

describe('OperationsPouchRepository', () => {
	let dbName: string;
	let repo: OperationsPouchRepository;

	beforeEach(() => {
		dbName = `test-operations-${Math.random().toString(36).slice(2)}`;
		repo = new OperationsPouchRepository(dbName);
	});

	it('persists a stock ledger entry and lists them', async () => {
		const entry = createReceiveEntry(
			{
				item_id: 'item:rice',
				qty: 100,
				unit: 'kg',
				source: 'purchase',
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
				source: 'purchase',
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
				{ item_id: 'item:rice', qty: 100, unit: 'kg', source: 'purchase', ref_id: null },
				ctx
			),
			createReceiveEntry(
				{ item_id: 'item:water', qty: 50, unit: 'bottle', source: 'donation', ref_id: null },
				ctx
			),
			// Let's create a negative entry (distribute) using the helper domain logic or raw ledger object
			// We can directly mock a distribute entry
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

	describe('distributeStock', () => {
		it('distributes stock and reduces balance when sufficient stock exists', async () => {
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 50, unit: 'bar', source: 'purchase', ref_id: null },
				ctx
			);

			const distributeEntry = await repo.distributeStock(
				{ item_id: 'item:soap', qty: 20, unit: 'bar', ref_id: null, note: 'Tent A' },
				ctx
			);

			expect(distributeEntry.item_id).toBe('item:soap');
			expect(distributeEntry.qty).toBe(-20);
			expect(distributeEntry.reason).toBe('distribute');
			expect(distributeEntry.lot?.note).toBe('Tent A');

			const balance = await repo.getBalance();
			expect(balance.get('item:soap')).toBe(30);
		});

		it('throws an error if attempting to distribute more than available stock', async () => {
			await repo.receiveStock(
				{ item_id: 'item:soap', qty: 10, unit: 'bar', source: 'purchase', ref_id: null },
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
});
