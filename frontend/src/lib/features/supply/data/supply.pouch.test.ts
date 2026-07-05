// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import PouchDB from 'pouchdb-browser';
import memory from 'pouchdb-adapter-memory';
import { SupplyCatalogPouchRepository } from './supply.pouch';
import type { SupplyItem } from '../domain/supply';

PouchDB.plugin(memory);

describe('SupplyCatalogPouchRepository', () => {
	let dbName: string;
	let repo: SupplyCatalogPouchRepository;
	let db: PouchDB.Database;

	beforeEach(async () => {
		dbName = `test-catalog-${Math.random().toString(36).slice(2)}`;
		db = new PouchDB(dbName, { adapter: 'memory' });
		repo = new SupplyCatalogPouchRepository(dbName);
		
		// Seed some test catalog items
		const items: SupplyItem[] = [
			{
				_id: 'item:rice01',
				type: 'supply_item',
				schema_v: 1,
				shelter_code: 'SH001',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: 'seed',
				name: 'Rice 5kg',
				category: 'food',
				unit: 'bag',
				reorder_level: 50,
				perishable: true
			},
			{
				_id: 'item:water01',
				type: 'supply_item',
				schema_v: 1,
				shelter_code: 'SH001',
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: 'seed',
				name: 'Water 1.5L',
				category: 'water',
				unit: 'bottle',
				reorder_level: 100,
				perishable: false
			},
			// Add a non-supply item to test filtering
			{
				_id: 'item:some_other_doc',
				type: 'not_a_supply_item',
				schema_v: 1,
				shelter_code: null,
				created_at: new Date().toISOString(),
				updated_at: new Date().toISOString(),
				created_by: 'seed',
				name: 'Invalid Item'
			} as unknown as SupplyItem
		];
		
		for (const item of items) {
			await db.put(item);
		}
	});

	it('listItems filters and returns only supply items', async () => {
		const items = await repo.listItems();
		expect(items).toHaveLength(2);
		expect(items.some(i => i._id === 'item:rice01')).toBe(true);
		expect(items.some(i => i._id === 'item:some_other_doc')).toBe(false);
	});

	it('getItem retrieves a specific item by ID', async () => {
		const item = await repo.getItem('item:water01');
		expect(item).not.toBeNull();
		expect(item?.name).toBe('Water 1.5L');
		expect(item?.unit).toBe('bottle');
	});

	it('getItem returns null for non-existent item', async () => {
		const item = await repo.getItem('item:missing');
		expect(item).toBeNull();
	});
});
