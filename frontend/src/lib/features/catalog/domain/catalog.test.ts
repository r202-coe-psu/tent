import { describe, it, expect } from 'vitest';
import {
	createItemMaster,
	isItemMaster,
	itemMasterInputSchema,
	createItemCategory,
	isItemCategory,
	itemCategoryInputSchema,
	createRecipe,
	isRecipe,
	recipeInputSchema,
	mergeCatalogGenerations
} from './catalog';
import type { AuthorContext } from '$lib/db/model';

describe('catalog domain', () => {
	const ctx: AuthorContext = {
		shelterCode: 'SH001',
		createdBy: 'test-user'
	};

	it('should validate valid item master input', () => {
		const input = {
			name: 'ข้าวสาร',
			base_unit: 'kg',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};
		const parsed = itemMasterInputSchema.parse(input);
		expect(parsed.name).toBe('ข้าวสาร');
		expect(parsed.base_unit).toBe('kg');
	});

	it('should create item master doc', () => {
		const input = {
			name: 'ยาพาราเซตามอล',
			base_unit: 'tablet',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		const doc = createItemMaster(input, ctx);
		expect(doc._id).toMatch(/^item_master:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_master');
		expect(doc.name).toBe('ยาพาราเซตามอล');
		expect(isItemMaster(doc)).toBe(true);
	});

	it('should validate valid item category input', () => {
		const input = {
			name: 'อาหารแห้ง'
		};
		const parsed = itemCategoryInputSchema.parse(input);
		expect(parsed.name).toBe('อาหารแห้ง');
	});

	it('should create item category doc with item_category: prefix', () => {
		const input = {
			name: 'เครื่องมือแพทย์'
		};
		const doc = createItemCategory(input, ctx);
		expect(doc._id).toMatch(/^item_category:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_category');
		expect(doc.name).toBe('เครื่องมือแพทย์');
		expect(isItemCategory(doc)).toBe(true);
	});

	it('should validate valid recipe input', () => {
		const input = {
			label: 'ข้าวผัดไข่มาตรฐาน',
			ingredients: [
				{ item_master_id: 'item_master_rice_123', quantity: 10, uom: 'kg' },
				{ item_master_id: 'item_master_egg_123', quantity: 100, uom: 'ชิ้น' }
			],
			standard_portions: 100,
			standard_duration_hours: 1.5
		};
		const parsed = recipeInputSchema.parse(input);
		expect(parsed.label).toBe('ข้าวผัดไข่มาตรฐาน');
		expect(parsed.ingredients).toHaveLength(2);
		expect(parsed.standard_portions).toBe('100');
	});

	it('should create recipe doc with recipe: prefix', () => {
		const input = {
			label: 'แกงจืดเต้าหู้หมูสับ',
			ingredients: [{ item_master_id: 'item_master_tofu_123', quantity: '50', uom: 'หลอด' }],
			standard_portions: '50',
			standard_duration_hours: '0.5'
		};
		const doc = createRecipe(input, ctx);
		expect(doc._id).toMatch(/^recipe:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('recipe');
		expect(doc.label).toBe('แกงจืดเต้าหู้หมูสับ');
		expect(isRecipe(doc)).toBe(true);
	});

	it('should validate conversions multiplier > 0 and allow fractions like 0.5', () => {
		const baseInput = {
			name: 'น้ำดื่ม',
			base_unit: 'bottle',
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		// 0.5 is valid
		const validParsed = itemMasterInputSchema.parse({
			...baseInput,
			conversions: [{ uom_name: 'pack', multiplier: 0.5 }]
		});
		expect(validParsed.conversions[0].multiplier).toBe('0.5');

		// 0 is invalid
		expect(() =>
			itemMasterInputSchema.parse({
				...baseInput,
				conversions: [{ uom_name: 'pack', multiplier: 0 }]
			})
		).toThrow();

		// -1 is invalid
		expect(() =>
			itemMasterInputSchema.parse({
				...baseInput,
				conversions: [{ uom_name: 'pack', multiplier: -1 }]
			})
		).toThrow();
	});

	it('should validate ingredients quantity > 0 and allow fractions like 0.5', () => {
		const baseRecipeInput = {
			label: 'น้ำพริก',
			standard_portions: 10,
			standard_duration_hours: 0.5
		};

		// 0.5 is valid
		const validParsed = recipeInputSchema.parse({
			...baseRecipeInput,
			ingredients: [{ item_master_id: 'item_1', quantity: 0.5, uom: 'kg' }]
		});
		expect(validParsed.ingredients[0].quantity).toBe('0.5');

		// 0 is invalid
		expect(() =>
			recipeInputSchema.parse({
				...baseRecipeInput,
				ingredients: [{ item_master_id: 'item_1', quantity: 0, uom: 'kg' }]
			})
		).toThrow();

		// -1 is invalid
		expect(() =>
			recipeInputSchema.parse({
				...baseRecipeInput,
				ingredients: [{ item_master_id: 'item_1', quantity: -1, uom: 'kg' }]
			})
		).toThrow();
	});

	it('should support deactivated field defaulting to false and accepting true', () => {
		const baseInput = {
			name: 'น้ำดื่ม',
			base_unit: 'bottle',
			conversions: [],
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const
		};

		const defaultParsed = itemMasterInputSchema.parse(baseInput);
		expect(defaultParsed.deactivated).toBeUndefined();

		const docWithDefault = createItemMaster(baseInput, ctx);
		expect(docWithDefault.deactivated).toBe(false);

		const deactivatedInput = {
			...baseInput,
			deactivated: true
		};
		const deactivatedParsed = itemMasterInputSchema.parse(deactivatedInput);
		expect(deactivatedParsed.deactivated).toBe(true);

		const docWithDeactivated = createItemMaster(deactivatedInput, ctx);
		expect(docWithDeactivated.deactivated).toBe(true);
	});

	it('should support deactivated field for Recipe defaulting to false and accepting true', () => {
		const baseInput = {
			label: 'น้ำพริก',
			ingredients: [{ item_master_id: 'item_1', quantity: '0.5', uom: 'kg' }],
			standard_portions: '10',
			standard_duration_hours: '0.5'
		};

		const defaultParsed = recipeInputSchema.parse(baseInput);
		expect(defaultParsed.deactivated).toBeUndefined();

		const docWithDefault = createRecipe(baseInput, ctx);
		expect(docWithDefault.deactivated).toBe(false);

		const deactivatedInput = {
			...baseInput,
			deactivated: true
		};
		const deactivatedParsed = recipeInputSchema.parse(deactivatedInput);
		expect(deactivatedParsed.deactivated).toBe(true);

		const docWithDeactivated = createRecipe(deactivatedInput, ctx);
		expect(docWithDeactivated.deactivated).toBe(true);
	});

	it('should support item class specific validations and fields', () => {
		// Consumable
		const consumableInput = {
			name: 'นมสด',
			base_unit: 'ขวด',
			distribution_type: 'recurring' as const,
			type_class: 'CONSUMABLE' as const,
			shelf_life_days: 7,
			storage_type: 'CHILLED' as const,
			allergens: 'นม'
		};
		const consumableParsed = itemMasterInputSchema.parse(consumableInput);
		expect(consumableParsed.shelf_life_days).toBe(7);
		expect(consumableParsed.storage_type).toBe('CHILLED');

		const consumableDoc = createItemMaster(consumableInput, ctx);
		expect(consumableDoc.shelf_life_days).toBe(7);

		// Durable
		const durableInput = {
			name: 'เต็นท์พักแรม',
			base_unit: 'หลัง',
			distribution_type: 'one_time' as const,
			type_class: 'DURABLE' as const,
			qty_per_person: 0.5,
			returnable: true
		};
		const durableParsed = itemMasterInputSchema.parse(durableInput);
		expect(durableParsed.qty_per_person).toBe(0.5);
		expect(durableParsed.returnable).toBe(true);

		const durableDoc = createItemMaster(durableInput, ctx);
		expect(durableDoc.qty_per_person).toBe(0.5);
		expect(durableDoc.returnable).toBe(true);

		// Equipment
		const equipmentInput = {
			name: 'เครื่องปั่นไฟ',
			type_class: 'EQUIPMENT' as const,
			asset_status: 'READY' as const
		};
		const equipmentParsed = itemMasterInputSchema.parse(equipmentInput);
		expect(equipmentParsed.asset_status).toBe('READY');
		expect(equipmentParsed.base_unit).toBeUndefined();

		const equipmentDoc = createItemMaster(equipmentInput, ctx);
		expect(equipmentDoc.asset_status).toBe('READY');
		expect(equipmentDoc.base_unit).toBe('ชิ้น');
	});

	it('should enforce required fields conditionally', () => {
		// For Consumable/Durable, base_unit is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'นมสด',
				distribution_type: 'recurring' as const,
				type_class: 'CONSUMABLE' as const
			})
		).toThrow();

		// For Consumable/Durable, distribution_type is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'นมสด',
				base_unit: 'ขวด',
				type_class: 'CONSUMABLE' as const
			})
		).toThrow();

		// For Equipment, asset_status is required
		expect(() =>
			itemMasterInputSchema.parse({
				name: 'เครื่องปั่นไฟ',
				type_class: 'EQUIPMENT' as const
			})
		).toThrow();
	});
});

// `item_master` replaces `supply_item` (schema.md §4.2) but the migration has not
// run, so the seed carries both generations of the same goods. Item pickers listed
// the two sources back to back and showed "ข้าวสาร (kg)" twice — with no way to see
// which id was being bound.
describe('mergeCatalogGenerations', () => {
	const supply = [
		{ _id: 'item:rice', name: 'ข้าวสาร', unit: 'kg', category: 'food', perishable: false },
		{ _id: 'item:water', name: 'น้ำดื่ม', unit: 'bottle', category: 'water', perishable: false }
	];
	const masters = [
		{ _id: 'item_master:rice', name: 'ข้าวสาร', base_unit: 'kg', category: 'food' },
		{ _id: 'item_master:canned-fish', name: 'ปลากระป๋อง', base_unit: 'can', category: 'food' }
	];

	it('lists each item once', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.map((m) => m.name)).toEqual(['ข้าวสาร', 'น้ำดื่ม', 'ปลากระป๋อง']);
	});

	// Every stock_ledger row and campaign need in the data is an `item:` id; binding a
	// new campaign to `item_master:rice` would open a second donor card for rice.
	it('keeps the legacy id when the same item exists in both generations', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.find((m) => m.name === 'ข้าวสาร')?._id).toBe('item:rice');
	});

	it('keeps an item_master that has no legacy twin', () => {
		const merged = mergeCatalogGenerations(supply, masters);
		expect(merged.find((m) => m.name === 'ปลากระป๋อง')?._id).toBe('item_master:canned-fish');
	});

	it('resolves the item_master unit through base_unit', () => {
		const merged = mergeCatalogGenerations([], masters);
		expect(merged.find((m) => m.name === 'ปลากระป๋อง')?.unit).toBe('can');
	});

	it('drops deactivated item masters', () => {
		const merged = mergeCatalogGenerations(
			[],
			[{ _id: 'item_master:old', name: 'เลิกใช้', base_unit: 'ชิ้น', deactivated: true }]
		);
		expect(merged).toEqual([]);
	});

	// Names arrive from two different seeds; a stray space must not defeat the match.
	it('matches names ignoring case and surrounding space', () => {
		const merged = mergeCatalogGenerations(
			[{ _id: 'item:soap', name: ' สบู่ก้อน ', unit: 'bar', category: 'hygiene' }],
			[{ _id: 'item_master:soap', name: 'สบู่ก้อน', base_unit: 'bar' }]
		);
		expect(merged).toHaveLength(1);
		expect(merged[0]._id).toBe('item:soap');
	});
});
