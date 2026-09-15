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
	SYSTEM_CATEGORY_KEYS,
	SYSTEM_CATEGORY_DEFINITIONS,
	systemCategoryDocId,
	isSystemCategoryDocId,
	categoryReferenceMatches,
	isFuelEnergyCategory,
	type ItemCategory,
	type TypeClass
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

	describe('CR-119: System Item Categories', () => {
		it('should have exactly 10 system category definitions with valid keys, IDs, and default classes', () => {
			expect(SYSTEM_CATEGORY_DEFINITIONS).toHaveLength(10);
			expect(SYSTEM_CATEGORY_KEYS).toHaveLength(10);

			const keys = SYSTEM_CATEGORY_DEFINITIONS.map((d) => d.key);
			const ids = SYSTEM_CATEGORY_DEFINITIONS.map((d) => d.id);
			expect(new Set(keys).size).toBe(10);
			expect(new Set(ids).size).toBe(10);

			for (const def of SYSTEM_CATEGORY_DEFINITIONS) {
				expect(SYSTEM_CATEGORY_KEYS).toContain(def.key);
				expect(def.id).toBe(`item_category:${def.key.toLowerCase()}`);
				expect(systemCategoryDocId(def.key)).toBe(def.id);
				expect(isSystemCategoryDocId(def.id)).toBe(true);
				expect(['CONSUMABLE', 'DURABLE', 'EQUIPMENT']).toContain(def.default_class);
				expect(def.name.trim().length).toBeGreaterThan(0);
				expect(def.description.trim().length).toBeGreaterThan(0);
			}

			expect(isSystemCategoryDocId('item_category:custom_123')).toBe(false);
		});

		it('should validate schema v2 item category input and custom creation invariants', () => {
			const validCustom = itemCategoryInputSchema.parse({
				name: 'เต็นท์ขนาดพิเศษ',
				default_class: 'DURABLE',
				description: 'เต็นท์พักแรมขนาด 6 คน'
			});
			expect(validCustom.default_class).toBe('DURABLE');
			expect(validCustom.description).toBe('เต็นท์พักแรมขนาด 6 คน');

			const doc = createItemCategory(validCustom, ctx);
			expect(doc.schema_v).toBe(2);
			expect(doc.is_protected).toBe(false);
			expect(doc.default_class).toBe('DURABLE');
			expect(doc.description).toBe('เต็นท์พักแรมขนาด 6 คน');
		});

		it('should reject invalid default_class in itemCategoryInputSchema', () => {
			expect(() =>
				itemCategoryInputSchema.parse({
					name: 'หมวดหมู่ทดสอบ',
					default_class: 'INVALID_CLASS' as unknown as TypeClass
				})
			).toThrow();
		});

		it('should match category references via categoryReferenceMatches helper', () => {
			const foodCat: ItemCategory = {
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
			};

			// Direct ID match
			expect(categoryReferenceMatches('item_category:food', foodCat)).toBe(true);
			// Direct name match
			expect(categoryReferenceMatches('อาหารและวัตถุดิบ (Food Ingredients)', foodCat)).toBe(true);
			// System key match
			expect(categoryReferenceMatches('FOOD', foodCat)).toBe(true);
			expect(categoryReferenceMatches('food', foodCat)).toBe(true);
			// Suffix slug match
			expect(categoryReferenceMatches('food', foodCat)).toBe(true);

			// Negative cases
			expect(categoryReferenceMatches('WATER', foodCat)).toBe(false);
			expect(categoryReferenceMatches('item_category:water', foodCat)).toBe(false);
			expect(categoryReferenceMatches('', foodCat)).toBe(false);
		});
	});

	describe('CR-120: Item Master for FUEL_ENERGY (LPG)', () => {
		it('should recognize fuel energy category references via isFuelEnergyCategory', () => {
			expect(isFuelEnergyCategory('item_category:fuel_energy')).toBe(true);
			expect(isFuelEnergyCategory('ITEM_CATEGORY:FUEL_ENERGY')).toBe(true);
			expect(isFuelEnergyCategory('FUEL_ENERGY')).toBe(true);
			expect(isFuelEnergyCategory('fuel_energy')).toBe(true);
			expect(isFuelEnergyCategory('เชื้อเพลิงและพลังงาน (Fuel & Energy)')).toBe(true);

			// Non-fuel categories
			expect(isFuelEnergyCategory('item_category:food')).toBe(false);
			expect(isFuelEnergyCategory('FOOD')).toBe(false);
			expect(isFuelEnergyCategory('WATER')).toBe(false);
			expect(isFuelEnergyCategory('')).toBe(false);
			expect(isFuelEnergyCategory(undefined)).toBe(false);

			// Custom categories list
			const customCategories: ItemCategory[] = [
				{
					_id: 'item_category:fuel_energy',
					type: 'item_category',
					schema_v: 2,
					name: 'เชื้อเพลิงและพลังงาน (Fuel & Energy)',
					system_key: 'FUEL_ENERGY',
					default_class: 'CONSUMABLE',
					is_protected: true,
					created_at: '2026-09-15T00:00:00.000Z',
					updated_at: '2026-09-15T00:00:00.000Z',
					created_by: 'system'
				}
			];
			expect(isFuelEnergyCategory('fuel_energy', customCategories)).toBe(true);
		});

		it('should parse valid LPG payload and persist as qty strings with default time_multiplier 1', () => {
			const input = {
				name: 'แก๊สหุงต้ม LPG 15 กิโลกรัม',
				category: 'item_category:fuel_energy',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5',
				type_class: 'CONSUMABLE' as const
			};

			const parsed = itemMasterInputSchema.parse(input);
			expect(parsed.capacity_kg).toBe('15');
			expect(parsed.burn_rate_kg_per_hour).toBe('0.5');
			expect(parsed.time_multiplier).toBeUndefined();

			const doc = createItemMaster(input, ctx);
			expect(doc.schema_v).toBe(4);
			expect(doc.base_unit).toBe('ถัง');
			expect(doc.fuel_type).toBe('LPG');
			expect(doc.capacity_kg).toBe('15');
			expect(doc.burn_rate_kg_per_hour).toBe('0.5');
			expect(doc.time_multiplier).toBe('1');
			expect(doc.type_class).toBe('CONSUMABLE');
			expect(doc.distribution_type).toBe('recurring');
		});

		it('should accept custom time_multiplier and numbers coerced to qty strings', () => {
			const input = {
				name: 'แก๊สหุงต้ม LPG 48 กก.',
				category: 'item_category:fuel_energy',
				capacity_kg: 48,
				burn_rate_kg_per_hour: 0.75,
				time_multiplier: 1.25,
				type_class: 'CONSUMABLE' as const
			};

			const doc = createItemMaster(input, ctx);
			expect(doc.capacity_kg).toBe('48');
			expect(doc.burn_rate_kg_per_hour).toBe('0.75');
			expect(doc.time_multiplier).toBe('1.25');
		});

		it('should reject missing capacity_kg or burn_rate_kg_per_hour for FUEL_ENERGY with correct path', () => {
			// Missing capacity_kg
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'CONSUMABLE' as const
				})
			).toThrowError(/capacity_kg/i);

			// Missing burn_rate_kg_per_hour
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '15',
					type_class: 'CONSUMABLE' as const
				})
			).toThrowError(/burn_rate/i);
		});

		it('should reject zero, negative, or invalid engineering values', () => {
			// Zero capacity
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '0',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'CONSUMABLE' as const
				})
			).toThrow();

			// Negative capacity
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '-15',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'CONSUMABLE' as const
				})
			).toThrow();

			// Zero burn rate
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0',
					type_class: 'CONSUMABLE' as const
				})
			).toThrow();

			// Negative time_multiplier
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'แก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0.5',
					time_multiplier: '-1',
					type_class: 'CONSUMABLE' as const
				})
			).toThrow();
		});

		it('should reject type_class other than CONSUMABLE for FUEL_ENERGY', () => {
			expect(() =>
				itemMasterInputSchema.parse({
					name: 'ถังแก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'DURABLE' as const
				})
			).toThrowError(/CONSUMABLE/);

			expect(() =>
				itemMasterInputSchema.parse({
					name: 'เตาแก๊ส',
					category: 'item_category:fuel_energy',
					capacity_kg: '15',
					burn_rate_kg_per_hour: '0.5',
					type_class: 'EQUIPMENT' as const,
					asset_status: 'READY' as const
				})
			).toThrowError(/CONSUMABLE/);
		});

		it('should override client base_unit and fuel_type to domain contract constants', () => {
			const input = {
				name: 'แก๊ส LPG 15kg',
				category: 'item_category:fuel_energy',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5',
				base_unit: 'กล่อง', // Client attempts wrong unit
				type_class: 'CONSUMABLE' as const
			};

			const doc = createItemMaster(input, ctx);
			expect(doc.base_unit).toBe('ถัง');
			expect(doc.fuel_type).toBe('LPG');
		});

		it('should omit food, dietary, and equipment fields from LPG document', () => {
			const input = {
				name: 'แก๊ส LPG 15kg',
				category: 'item_category:fuel_energy',
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5',
				type_class: 'CONSUMABLE' as const,
				// Stale or irrelevant fields
				shelf_life_days: 365,
				storage_type: 'DRY' as const,
				allergens: 'none',
				target_gender: 'ALL' as const,
				age_group: 'ALL' as const,
				dietary: ['HALAL' as const],
				qty_per_person: 1,
				returnable: true,
				asset_status: 'READY' as const
			};

			const doc = createItemMaster(input, ctx);
			expect(doc.fuel_type).toBe('LPG');
			expect(doc.capacity_kg).toBe('15');
			expect(doc.burn_rate_kg_per_hour).toBe('0.5');
			expect(doc.time_multiplier).toBe('1');

			// Assert that food and durable/equipment fields are omitted
			expect(doc.shelf_life_days).toBeUndefined();
			expect(doc.storage_type).toBeUndefined();
			expect(doc.allergens).toBeUndefined();
			expect(doc.target_gender).toBeUndefined();
			expect(doc.age_group).toBeUndefined();
			expect(doc.dietary).toBeUndefined();
			expect(doc.qty_per_person).toBeUndefined();
			expect(doc.returnable).toBeUndefined();
			expect(doc.asset_status).toBeUndefined();
		});

		it('should omit LPG fields from non-fuel Item Master and preserve food/durable fields', () => {
			const foodInput = {
				name: 'ข้าวหอมมะลิ',
				category: 'item_category:food',
				base_unit: 'kg',
				type_class: 'CONSUMABLE' as const,
				distribution_type: 'recurring' as const,
				shelf_life_days: 180,
				storage_type: 'DRY' as const,
				allergens: 'ไม่มี',
				dietary: ['HALAL' as const],
				// Attempt to inject LPG fields into food
				fuel_type: 'LPG' as const,
				capacity_kg: '15',
				burn_rate_kg_per_hour: '0.5'
			};

			const doc = createItemMaster(foodInput, ctx);
			expect(doc.fuel_type).toBeUndefined();
			expect(doc.capacity_kg).toBeUndefined();
			expect(doc.burn_rate_kg_per_hour).toBeUndefined();
			expect(doc.time_multiplier).toBeUndefined();

			expect(doc.name).toBe('ข้าวหอมมะลิ');
			expect(doc.shelf_life_days).toBe(180);
			expect(doc.storage_type).toBe('DRY');
			expect(doc.allergens).toBe('ไม่มี');
			expect(doc.dietary).toEqual(['HALAL']);
		});
	});
});
