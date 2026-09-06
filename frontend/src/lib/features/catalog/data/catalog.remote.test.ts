// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createInMemoryRepository } from '$lib/db/in-memory-repository';

vi.mock('$lib/db/shelter', () => ({
	SHELTER_CODE: 'SH001',
	SHELTER_DB: 'shelter_sh001',
	getShelterDb: () => 'shelter_sh001'
}));

const dbs = new Map<string, ReturnType<typeof createInMemoryRepository>>();
function getDb(name: string) {
	if (!dbs.has(name)) {
		dbs.set(name, createInMemoryRepository());
	}
	return dbs.get(name)!;
}

vi.mock('$lib/db/repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/db/repository')>();
	return { ...actual, createRemoteRepository: (name: string) => getDb(name) };
});

import { CatalogRemoteRepository } from './catalog.remote';
import type { AuthorContext } from '$lib/db/model';

const ctx: AuthorContext = { shelterCode: 'SH001', createdBy: 'tester' };

describe('CatalogRemoteRepository', () => {
	let repo: CatalogRemoteRepository;

	beforeEach(async () => {
		dbs.clear();
		repo = new CatalogRemoteRepository();
	});

	it('should delete recipe physically if not used by any meal plan', async () => {
		// 1. Create a recipe
		const recipe = await repo.createRecipe(
			{
				label: 'ข้าวผัด',
				ingredients: [{ item_master_id: 'item_1', quantity: '10', uom: 'kg' }],
				standard_portions: '100',
				standard_duration_hours: '1'
			},
			ctx
		);

		expect(recipe._id).toBeDefined();

		// Verify it is in DB
		const foundBefore = await repo.getRecipe(recipe._id);
		expect(foundBefore).not.toBeNull();

		// 2. Delete recipe
		const wasDeleted = await repo.deleteRecipe(recipe._id);
		expect(wasDeleted).toBe(true);

		// Verify it is removed from DB
		const foundAfter = await repo.getRecipe(recipe._id);
		expect(foundAfter).toBeNull();
	});

	it('should deactivate recipe if it is used by a meal plan', async () => {
		// 1. Create a recipe
		const recipe = await repo.createRecipe(
			{
				label: 'ข้าวต้ม',
				ingredients: [{ item_master_id: 'item_1', quantity: '10', uom: 'kg' }],
				standard_portions: '100',
				standard_duration_hours: '1'
			},
			ctx
		);

		// 2. Simulate a meal plan using this recipe in the shelter DB
		await getDb('shelter_sh001').put({
			_id: 'meal_plan:some-ulid',
			type: 'meal_plan',
			date: '2026-08-05',
			meal: 'breakfast',
			recipes: [{ recipe_id: recipe._id, planned_qty: 100 }],
			status: 'confirmed'
		});

		// 3. Delete recipe
		const wasDeleted = await repo.deleteRecipe(recipe._id);
		expect(wasDeleted).toBe(false); // Should return false because it is deactivated, not deleted

		// 4. Verify it is still in DB but marked deactivated
		const found = await repo.getRecipe(recipe._id);
		expect(found).not.toBeNull();
		expect(found?.deactivated).toBe(true);
	});

	describe('database-level overrides (Option 3)', () => {
		it('should list central items when no shelter code is passed', async () => {
			// Create a central item (shelterCode is undefined)
			const item = await repo.createItemMaster(
				{
					name: 'ข้าวหอมมะลิกลาง',
					base_unit: 'kg',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);

			const centralList = await repo.listItemMasters();
			expect(centralList.length).toBe(1);
			expect(centralList[0]._id).toBe(item._id);
			expect(centralList[0].shelter_code).toBeUndefined();
		});

		it('should merge central and shelter DB items, and override items with matching ID', async () => {
			// 1. Create a central item
			const item = await repo.createItemMaster(
				{
					name: 'ข้าวหอมมะลิกลาง',
					base_unit: 'kg',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);

			// 2. Query for SH001 - should see central item
			const list1 = await repo.listItemMasters('SH001');
			expect(list1.length).toBe(1);
			expect(list1[0].name).toBe('ข้าวหอมมะลิกลาง');

			// 3. Create a local override in shelter_sh001 DB with the same ID, specifying shelterCode
			const overrideDoc = {
				...item,
				name: 'ข้าวหอมมะลิเฉพาะศูนย์ SH001',
				shelter_code: 'SH001',
				override: true
			};
			await repo.updateItemMaster(overrideDoc);

			// 4. Query for SH001 again - should see the overridden version from local DB
			const list2 = await repo.listItemMasters('SH001');
			expect(list2.length).toBe(1);
			expect(list2[0].name).toBe('ข้าวหอมมะลิเฉพาะศูนย์ SH001');
			expect(list2[0].shelter_code).toBe('SH001');
			expect(list2[0].override).toBe(true);

			// 5. Query for central - central item should remain unchanged
			const listCentral = await repo.listItemMasters();
			expect(listCentral.length).toBe(1);
			expect(listCentral[0].name).toBe('ข้าวหอมมะลิกลาง');
			expect(listCentral[0].shelter_code).toBeUndefined();

			// 6. Delete override (Reset) - should remove override and fall back to central
			const wasDeleted = await repo.deleteItemMaster(item._id, 'SH001');
			expect(wasDeleted).toBe(true); // Physically deleted from shelter DB because no stock ledger transactions exist

			// 7. Query for SH001 - should see central item again
			const list3 = await repo.listItemMasters('SH001');
			expect(list3.length).toBe(1);
			expect(list3[0].name).toBe('ข้าวหอมมะลิกลาง');
			expect(list3[0].shelter_code).toBeUndefined();
		});

		it('should reset (delete) override item even if stock ledger transactions exist', async () => {
			// 1. Create a central item
			const item = await repo.createItemMaster(
				{
					name: 'ข้าวหอมมะลิกลาง',
					base_unit: 'kg',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);

			// 2. Create a local override in shelter_sh001 DB with the same ID, specifying shelterCode
			const overrideDoc = {
				...item,
				name: 'ข้าวหอมมะลิเฉพาะศูนย์ SH001',
				shelter_code: 'SH001',
				override: true
			};
			await repo.updateItemMaster(overrideDoc);

			// 3. Simulate a stock ledger entry referencing this item id in shelter_sh001 DB
			await getDb('shelter_sh001').put({
				_id: 'stock_ledger:some-ulid',
				type: 'stock_ledger',
				item_id: item._id,
				quantity: '10'
			});

			// 4. Delete override (Reset) - should bypass stock ledger checks and physically delete override doc
			const wasDeleted = await repo.deleteItemMaster(item._id, 'SH001');
			expect(wasDeleted).toBe(true);

			// 5. Query for SH001 - should see central item again
			const list3 = await repo.listItemMasters('SH001');
			expect(list3.length).toBe(1);
			expect(list3[0].name).toBe('ข้าวหอมมะลิกลาง');
			expect(list3[0].shelter_code).toBeUndefined();
			expect(list3[0].override).toBeUndefined();
		});

		it('should reset (delete) override recipe even if meal plans exist', async () => {
			// 1. Create a central recipe
			const recipe = await repo.createRecipe(
				{
					label: 'แกงส้มกลาง',
					ingredients: [{ item_master_id: 'item_1', quantity: '2', uom: 'kg' }],
					standard_portions: '50',
					standard_duration_hours: '1'
				},
				ctx
			);

			// 2. Create a local override in shelter_sh001 DB
			const overrideDoc = {
				...recipe,
				label: 'แกงส้มเฉพาะศูนย์ SH001',
				shelter_code: 'SH001',
				override: true
			};
			await repo.updateRecipe(overrideDoc);

			// 3. Simulate a meal plan referencing this recipe in shelter_sh001 DB
			await getDb('shelter_sh001').put({
				_id: 'meal_plan:some-ulid',
				type: 'meal_plan',
				recipes: [{ recipe_id: recipe._id, planned_qty: 50 }]
			});

			// 4. Delete override (Reset) - should bypass meal plan checks and delete override doc
			const wasDeleted = await repo.deleteRecipe(recipe._id, 'SH001');
			expect(wasDeleted).toBe(true);

			// 5. Query for SH001 - should see central recipe again
			const list = await repo.listRecipes('SH001');
			expect(list.length).toBe(1);
			expect(list[0].label).toBe('แกงส้มกลาง');
			expect(list[0].shelter_code).toBeUndefined();
		});

		it('should reset (delete) override category even if it is used by item masters', async () => {
			// 1. Create a central category
			const category = await repo.createItemCategory(
				{
					name: 'อาหารแห้งกลาง'
				},
				ctx
			);

			// 2. Create a local override in shelter_sh001 DB
			const overrideDoc = {
				...category,
				name: 'อาหารแห้งเฉพาะศูนย์ SH001',
				shelter_code: 'SH001',
				override: true
			};
			await repo.updateItemCategory(overrideDoc);

			// 3. Create an item master using this category name
			await repo.createItemMaster(
				{
					name: 'บะหมี่สำเร็จรูป',
					base_unit: 'ซอง',
					category: 'อาหารแห้งเฉพาะศูนย์ SH001',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx,
				'SH001'
			);

			// 4. Delete override (Reset) - should bypass category usage checks and delete override doc
			const result = await repo.deleteItemCategory(category._id, 'SH001');
			expect(result.wasDeleted).toBe(true);
			expect(result.actionTaken).toBe('reset');

			// 5. Query for SH001 - should see central category again
			const list = await repo.listItemCategories('SH001');
			expect(list.length).toBe(1);
			expect(list[0].name).toBe('อาหารแห้งกลาง');
			expect(list[0].shelter_code).toBeUndefined();
		});

		it('should deactivate category when deleted if used by an item master', async () => {
			const category = await repo.createItemCategory({ name: 'เครื่องดื่ม' }, ctx);

			await repo.createItemMaster(
				{
					name: 'น้ำดื่มบรรจุขวด',
					base_unit: 'ขวด',
					category: 'เครื่องดื่ม',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);

			// Check usage details
			const usage = await repo.inspectCategoryUsage(category._id);
			expect(usage.centralItemMasters).toContain('น้ำดื่มบรรจุขวด');
			expect(usage.totalItemCount).toBe(1);

			// Should not delete physically, but mark deactivated = true
			const result = await repo.deleteItemCategory(category._id);
			expect(result.wasDeleted).toBe(false);
			expect(result.actionTaken).toBe('deactivate');

			const updated = await repo.getItemCategory(category._id);
			expect(updated).not.toBeNull();
			expect(updated?.deactivated).toBe(true);
		});

		it('should remove category physically when deleted if not used by any item master', async () => {
			const category = await repo.createItemCategory({ name: 'หมวดหมู่ว่าง' }, ctx);

			const usage = await repo.inspectCategoryUsage(category._id);
			expect(usage.totalItemCount).toBe(0);

			const result = await repo.deleteItemCategory(category._id);
			expect(result.wasDeleted).toBe(true);
			expect(result.actionTaken).toBe('hard_delete');

			const removed = await repo.getItemCategory(category._id);
			expect(removed).toBeNull();
		});
	});
});
