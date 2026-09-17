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

	it('should deactivate central recipe when deleted even if not used by any meal plan', async () => {
		// 1. Create a recipe in central scope
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

		// 2. Delete recipe in central scope -> should deactivate
		const wasDeleted = await repo.deleteRecipe(recipe._id);
		expect(wasDeleted).toBe(false);

		// Verify it remains in DB with deactivated = true
		const foundAfter = await repo.getRecipe(recipe._id);
		expect(foundAfter).not.toBeNull();
		expect(foundAfter?.deactivated).toBe(true);
	});

	it('should delete custom recipe physically in shelter scope if not used by any meal plan', async () => {
		const recipe = await repo.createRecipe(
			{
				label: 'ข้าวผัดเฉพาะศูนย์',
				ingredients: [{ item_master_id: 'item_1', quantity: '10', uom: 'kg' }],
				standard_portions: '100',
				standard_duration_hours: '1'
			},
			ctx,
			'SH001'
		);

		const wasDeleted = await repo.deleteRecipe(recipe._id, 'SH001');
		expect(wasDeleted).toBe(true);

		const foundAfter = await repo.getRecipe(recipe._id, 'SH001');
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

		it('should deactivate category when deleted in central scope even if unused by any item master', async () => {
			const category = await repo.createItemCategory({ name: 'หมวดหมู่ว่าง' }, ctx);

			const usage = await repo.inspectCategoryUsage(category._id);
			expect(usage.totalItemCount).toBe(0);

			const result = await repo.deleteItemCategory(category._id);
			expect(result.wasDeleted).toBe(false);
			expect(result.actionTaken).toBe('deactivate');

			const updated = await repo.getItemCategory(category._id);
			expect(updated).not.toBeNull();
			expect(updated?.deactivated).toBe(true);
		});

		it('should remove custom category physically in shelter scope if not used by any item master', async () => {
			const category = await repo.createItemCategory(
				{ name: 'หมวดหมู่เฉพาะศูนย์ว่าง' },
				ctx,
				'SH001'
			);

			const result = await repo.deleteItemCategory(category._id, 'SH001');
			expect(result.wasDeleted).toBe(true);
			expect(result.actionTaken).toBe('hard_delete');

			const removed = await repo.getItemCategory(category._id, 'SH001');
			expect(removed).toBeNull();
		});

		it('CR-119: should reject deletion of system protected categories', async () => {
			// Seed a system protected category doc
			await getDb('catalog').put({
				_id: 'item_category:food',
				type: 'item_category',
				schema_v: 2,
				name: 'อาหารและวัตถุดิบ (Food Ingredients)',
				system_key: 'FOOD',
				default_class: 'CONSUMABLE',
				is_protected: true,
				created_at: '2026-09-15T00:00:00.000Z',
				updated_at: '2026-09-15T00:00:00.000Z',
				created_by: 'system'
			});

			await expect(repo.deleteItemCategory('item_category:food')).rejects.toThrow(
				'ไม่อนุญาตให้ลบหมวดหมู่ระบบมาตรฐาน'
			);
		});

		it('CR-119: should reject local override on protected categories', async () => {
			await getDb('catalog').put({
				_id: 'item_category:water',
				type: 'item_category',
				schema_v: 2,
				name: 'น้ำดื่มสะอาด (Drinking Water)',
				system_key: 'WATER',
				default_class: 'CONSUMABLE',
				is_protected: true,
				created_at: '2026-09-15T00:00:00.000Z',
				updated_at: '2026-09-15T00:00:00.000Z',
				created_by: 'system'
			});

			// Attempting override in shelter
			await expect(
				repo.updateItemCategory({
					_id: 'item_category:water',
					type: 'item_category',
					schema_v: 2,
					name: 'น้ำดื่มเฉพาะศูนย์',
					shelter_code: 'SH001',
					override: true,
					created_at: '2026-09-15T00:00:00.000Z',
					updated_at: '2026-09-15T00:00:00.000Z',
					created_by: 'tester'
				})
			).rejects.toThrow('ไม่อนุญาตให้สร้าง local override บนหมวดหมู่ระบบมาตรฐาน');
		});

		it('CR-119/CR-125: should preserve system_key/is_protected but allow default_class on protected category updates', async () => {
			await getDb('catalog').put({
				_id: 'item_category:bedding',
				type: 'item_category',
				schema_v: 2,
				name: 'เครื่องนอนและที่พักพิง (Shelter & Bedding)',
				system_key: 'BEDDING',
				default_class: 'DURABLE',
				is_protected: true,
				created_at: '2026-09-15T00:00:00.000Z',
				updated_at: '2026-09-15T00:00:00.000Z',
				created_by: 'system'
			});

			// System Admin updates name, description, and default_class (CR-125), and tries to
			// change system_key and unprotect the category (still not allowed).
			const updated = await repo.updateItemCategory({
				_id: 'item_category:bedding',
				type: 'item_category',
				schema_v: 2,
				name: 'เครื่องนอนและเต็นท์',
				description: 'คำอธิบายใหม่',
				system_key: 'WATER', // Attempted change
				default_class: 'CONSUMABLE', // CR-125: allowed change
				is_protected: false as unknown as boolean, // Attempted unprotect
				created_at: '2026-09-15T00:00:00.000Z',
				updated_at: '2026-09-15T00:00:00.000Z',
				created_by: 'system_admin'
			});

			expect(updated.name).toBe('เครื่องนอนและเต็นท์');
			expect(updated.description).toBe('คำอธิบายใหม่');
			// CR-125: default_class is now editable on protected categories
			expect(updated.default_class).toBe('CONSUMABLE');
			// system_key and is_protected remain immutable per CR-119 FR-04
			expect(updated.is_protected).toBe(true);
			expect(updated.system_key).toBe('BEDDING');
		});

		it('CR-119: should canonicalize item_master.category to canonical _id on create and update', async () => {
			// 1. Create with system category name
			const item1 = await repo.createItemMaster(
				{
					name: 'ปลากระป๋อง',
					base_unit: 'กระป๋อง',
					category: 'อาหารและวัตถุดิบ (Food Ingredients)',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);
			expect(item1.category).toBe('item_category:food');

			// 2. Create with system key string
			const item2 = await repo.createItemMaster(
				{
					name: 'ถังแก๊ส LPG 15kg',
					base_unit: 'ถัง',
					category: 'FUEL_ENERGY',
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0.5',
					distribution_type: 'recurring',
					type_class: 'CONSUMABLE',
					dietary: []
				},
				ctx
			);
			expect(item2.category).toBe('item_category:fuel_energy');
			expect(item2.fuel_type).toBe('LPG');
			expect(item2.capacity_kg).toBe('15');

			// 3. Update legacy item master where category was name
			item2.category = 'อาหารและวัตถุดิบ (Food Ingredients)';
			const updatedItem = await repo.updateItemMaster(item2);
			expect(updatedItem.category).toBe('item_category:food');
			expect(updatedItem.fuel_type).toBeUndefined();
			expect(updatedItem.capacity_kg).toBeUndefined();
		});

		it('CR-119: should reject unknown or ambiguous category references', async () => {
			// 1. Unknown category reference
			await expect(
				repo.createItemMaster(
					{
						name: 'ของเล่นเด็ก',
						base_unit: 'ชิ้น',
						category: 'หมวดหมู่ที่ไม่มีอยู่จริง',
						distribution_type: 'recurring',
						type_class: 'CONSUMABLE',
						dietary: []
					},
					ctx
				)
			).rejects.toThrow(/ไม่พบหมวดหมู่/);

			// 2. Ambiguous category reference (multiple matching categories)
			await repo.createItemCategory({ name: 'อุปกรณ์ซ่อมบำรุง' }, ctx);
			await repo.createItemCategory({ name: 'อุปกรณ์ซ่อมบำรุง' }, ctx);

			await expect(
				repo.createItemMaster(
					{
						name: 'ค้อน',
						base_unit: 'อัน',
						category: 'อุปกรณ์ซ่อมบำรุง',
						distribution_type: 'recurring',
						type_class: 'CONSUMABLE',
						dietary: []
					},
					ctx
				)
			).rejects.toThrow(/ข้อมูลซ้ำซ้อน/);
		});

		it('CR-120: should enforce LPG invariant on repository create, direct update, and shelter override', async () => {
			// 1. Create LPG Item Master via repository
			const lpgDoc = await repo.createItemMaster(
				{
					name: 'แก๊สหุงต้ม LPG 15 กิโลกรัม',
					category: 'item_category:fuel_energy',
					base_unit: 'กล่อง', // Client sends invalid unit
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'CONSUMABLE' as const
				},
				ctx
			);

			expect(lpgDoc.category).toBe('item_category:fuel_energy');
			expect(lpgDoc.base_unit).toBe('ถัง'); // Must be overridden to ถัง
			expect(lpgDoc.fuel_type).toBe('LPG'); // Must be set to LPG
			expect(lpgDoc.capacity_kg).toBe('15');
			expect(lpgDoc.burn_rate_kg_per_hour).toBe('0.5');
			expect(lpgDoc.time_multiplier).toBe('1'); // Defaulted
			expect(lpgDoc.type_class).toBe('CONSUMABLE');

			// 2. Reject invalid direct update
			const invalidUpdate = {
				...lpgDoc,
				capacity_kg: '0' // Zero capacity is invalid
			};
			await expect(repo.updateItemMaster(invalidUpdate)).rejects.toThrow();

			// 3. Direct update with stale hidden fields (food fields must be stripped)
			const updateWithStale = {
				...lpgDoc,
				burn_rate_kg_per_hour: '0.6',
				shelf_life_days: 90, // Stale food field
				allergens: 'ถั่ว', // Stale food field
				dietary: ['HALAL' as const] // Stale food field
			};
			const updated = await repo.updateItemMaster(updateWithStale);
			expect(updated.burn_rate_kg_per_hour).toBe('0.6');
			expect(updated.shelf_life_days).toBeUndefined();
			expect(updated.allergens).toBeUndefined();
			expect(updated.dietary).toBeUndefined();

			// 4. Create shelter override from central LPG
			const centralItem = await repo.getItemMaster(lpgDoc._id);
			expect(centralItem).not.toBeNull();

			// eslint-disable-next-line @typescript-eslint/no-unused-vars
			const { _rev, ...itemWithoutRev } = centralItem!;
			const overridePayload = {
				...itemWithoutRev,
				shelter_code: 'SH001',
				override: true,
				burn_rate_kg_per_hour: '0.45'
			};

			const overrideDoc = await repo.updateItemMaster(overridePayload);
			expect(overrideDoc._id).toBe(centralItem!._id);
			expect(overrideDoc.shelter_code).toBe('SH001');
			expect(overrideDoc.override).toBe(true);
			expect(overrideDoc.base_unit).toBe('ถัง');
			expect(overrideDoc.fuel_type).toBe('LPG');
			expect(overrideDoc.capacity_kg).toBe('15');
			expect(overrideDoc.burn_rate_kg_per_hour).toBe('0.45');

			// Verify shelter DB contains the override and central DB retains original
			const localItem = await repo.getItemMaster(lpgDoc._id, 'SH001');
			expect(localItem?.burn_rate_kg_per_hour).toBe('0.45');
			expect(localItem?.shelter_code).toBe('SH001');

			const centralItemStillIntact = await repo.getItemMaster(lpgDoc._id);
			expect(centralItemStillIntact?.burn_rate_kg_per_hour).toBe('0.6');
			expect(centralItemStillIntact?.shelter_code).toBeUndefined();
		});
	});
});
