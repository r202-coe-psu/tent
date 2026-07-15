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
	recipeInputSchema
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
			distribution_type: 'consumable' as const,
			target_audience_type: 'all' as const,
			target_restrictions: {
				genders: [],
				vulnerable_groups: [],
				diet_religions: []
			},
			is_default: false
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
			distribution_type: 'consumable' as const,
			target_audience_type: 'all' as const,
			target_restrictions: {
				genders: [],
				vulnerable_groups: [],
				diet_religions: []
			},
			is_default: true
		};

		const doc = createItemMaster(input, ctx);
		expect(doc._id).toMatch(/^item_master:[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(doc.type).toBe('item_master');
		expect(doc.name).toBe('ยาพาราเซตามอล');
		expect(isItemMaster(doc)).toBe(true);
	});

	it('should validate valid item category input', () => {
		const input = {
			name: 'อาหารแห้ง',
			is_default: true
		};
		const parsed = itemCategoryInputSchema.parse(input);
		expect(parsed.name).toBe('อาหารแห้ง');
		expect(parsed.is_default).toBe(true);
	});

	it('should create item category doc with item_category: prefix', () => {
		const input = {
			name: 'เครื่องมือแพทย์',
			is_default: false
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
			standard_duration_hours: 1.5,
			is_default: true
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
			standard_duration_hours: '0.5',
			is_default: false
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
			distribution_type: 'consumable' as const,
			target_audience_type: 'all' as const,
			target_restrictions: { genders: [], vulnerable_groups: [], diet_religions: [] },
			is_default: false
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
			standard_duration_hours: 0.5,
			is_default: false
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
});
