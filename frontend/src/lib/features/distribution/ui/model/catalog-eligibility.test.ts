import { describe, expect, it } from 'vitest';
import type { ItemMaster } from '$lib/features/catalog';
import {
	isEligibleDistributionCatalogItem,
	getReturnableBadgeLabel,
	getReturnableBadgeClass,
	isReadyMealCategory,
	isKitchenFoodCategory,
	isAnyFoodCategory,
	READY_MEAL_CATEGORY_ID,
	KITCHEN_FOOD_CATEGORY_ID
} from './catalog-eligibility';

const mockItem = (overrides: Partial<ItemMaster> = {}): ItemMaster => {
	const base: ItemMaster = {
		_id: 'item_master:test_01',
		type: 'item_master',
		schema_v: 1,
		created_at: '2026-09-19T10:00:00.000Z',
		updated_at: '2026-09-19T10:00:00.000Z',
		created_by: 'system',
		name: 'ทดสอบ',
		base_unit: 'box',
		conversions: [],
		type_class: 'CONSUMABLE',
		dietary: [],
		returnable: false
	};

	return {
		...base,
		...overrides,
		schema_v: overrides.schema_v ?? base.schema_v,
		created_at: overrides.created_at ?? base.created_at,
		updated_at: overrides.updated_at ?? base.updated_at,
		created_by: overrides.created_by ?? base.created_by
	};
};

describe('Catalog Eligibility (Slice 5.1 §41)', () => {
	describe('Food Ticket Eligibility', () => {
		it('allows READY_MEAL category with CONSUMABLE and returnable=false', () => {
			const readyMeal = mockItem({
				name: 'ข้าวกะเพราไก่',
				category: READY_MEAL_CATEGORY_ID,
				type_class: 'CONSUMABLE',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(readyMeal, 'food')).toBe(true);
		});

		it('allows READY_MEAL system key', () => {
			const readyMeal = mockItem({
				name: 'ข้าวผัด',
				category: 'READY_MEAL',
				type_class: 'CONSUMABLE',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(readyMeal, 'food')).toBe(true);
		});

		it('strictly rejects kitchen/raw FOOD category', () => {
			const kitchenFood = mockItem({
				name: 'ข้าวสาร 5 กก.',
				category: KITCHEN_FOOD_CATEGORY_ID,
				type_class: 'CONSUMABLE',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(kitchenFood, 'food')).toBe(false);
		});

		it('strictly rejects kitchen FOOD system key', () => {
			const kitchenFood = mockItem({
				name: 'น้ำมันพืช',
				category: 'FOOD',
				type_class: 'CONSUMABLE',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(kitchenFood, 'food')).toBe(false);
		});

		it('strictly rejects non-food relief supplies (e.g. bedding, medical)', () => {
			const blanket = mockItem({
				name: 'ผ้าห่ม',
				category: 'item_category:bedding',
				type_class: 'DURABLE',
				returnable: true
			});
			expect(isEligibleDistributionCatalogItem(blanket, 'food')).toBe(false);
		});

		it('rejects food item if type_class is not CONSUMABLE', () => {
			const invalidMeal = mockItem({
				name: 'อาหารแปลก',
				category: READY_MEAL_CATEGORY_ID,
				type_class: 'EQUIPMENT',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(invalidMeal, 'food')).toBe(false);
		});

		it('rejects food item if marked returnable', () => {
			const returnableFood = mockItem({
				name: 'อาหารยืมคืน',
				category: READY_MEAL_CATEGORY_ID,
				type_class: 'CONSUMABLE',
				returnable: true
			});
			expect(isEligibleDistributionCatalogItem(returnableFood, 'food')).toBe(false);
		});

		it('rejects deactivated item even if category is ready_meal', () => {
			const deactivatedMeal = mockItem({
				name: 'อาหารเก่า',
				category: READY_MEAL_CATEGORY_ID,
				type_class: 'CONSUMABLE',
				returnable: false,
				deactivated: true
			});
			expect(isEligibleDistributionCatalogItem(deactivatedMeal, 'food')).toBe(false);
		});
	});

	describe('Supplies Ticket Eligibility', () => {
		it('strictly rejects READY_MEAL category', () => {
			const readyMeal = mockItem({
				name: 'ข้าวกะเพราไก่',
				category: READY_MEAL_CATEGORY_ID,
				type_class: 'CONSUMABLE'
			});
			expect(isEligibleDistributionCatalogItem(readyMeal, 'supplies')).toBe(false);
		});

		it('strictly rejects kitchen FOOD category', () => {
			const kitchenIngredient = mockItem({
				name: 'เนื้อไก่สด',
				category: KITCHEN_FOOD_CATEGORY_ID,
				type_class: 'CONSUMABLE'
			});
			expect(isEligibleDistributionCatalogItem(kitchenIngredient, 'supplies')).toBe(false);
		});

		it('allows non-food relief supplies (consumable, e.g. hygiene kit)', () => {
			const hygieneKit = mockItem({
				name: 'สบู่ก้อน',
				category: 'item_category:wash',
				type_class: 'CONSUMABLE',
				returnable: false
			});
			expect(isEligibleDistributionCatalogItem(hygieneKit, 'supplies')).toBe(true);
		});

		it('allows durable returnable supplies (e.g. fan, tent)', () => {
			const fan = mockItem({
				name: 'พัดลมตั้งโต๊ะ',
				category: 'item_category:bedding',
				type_class: 'EQUIPMENT',
				returnable: true
			});
			expect(isEligibleDistributionCatalogItem(fan, 'supplies')).toBe(true);
		});

		it('rejects deactivated supplies item', () => {
			const deactivatedFan = mockItem({
				name: 'พัดลมชำรุด',
				category: 'item_category:bedding',
				type_class: 'EQUIPMENT',
				returnable: true,
				deactivated: true
			});
			expect(isEligibleDistributionCatalogItem(deactivatedFan, 'supplies')).toBe(false);
		});
	});

	describe('Category classification helpers', () => {
		it('correctly identifies ready meal category', () => {
			expect(isReadyMealCategory(READY_MEAL_CATEGORY_ID)).toBe(true);
			expect(isReadyMealCategory('READY_MEAL')).toBe(true);
			expect(isReadyMealCategory('ready_meal')).toBe(true);
			expect(isReadyMealCategory(KITCHEN_FOOD_CATEGORY_ID)).toBe(false);
			expect(isReadyMealCategory('item_category:wash')).toBe(false);
			expect(isReadyMealCategory(undefined)).toBe(false);
		});

		it('correctly identifies kitchen food category', () => {
			expect(isKitchenFoodCategory(KITCHEN_FOOD_CATEGORY_ID)).toBe(true);
			expect(isKitchenFoodCategory('FOOD')).toBe(true);
			expect(isKitchenFoodCategory('food')).toBe(true);
			expect(isKitchenFoodCategory(READY_MEAL_CATEGORY_ID)).toBe(false);
			expect(isKitchenFoodCategory(undefined)).toBe(false);
		});

		it('correctly identifies any food category', () => {
			expect(isAnyFoodCategory(READY_MEAL_CATEGORY_ID)).toBe(true);
			expect(isAnyFoodCategory(KITCHEN_FOOD_CATEGORY_ID)).toBe(true);
			expect(isAnyFoodCategory('item_category:wash')).toBe(false);
			expect(isAnyFoodCategory('item_category:bedding')).toBe(false);
		});
	});

	describe('Returnable presentation (Read-only Catalog-owned)', () => {
		it('maps returnable=false to "แจกจ่าย"', () => {
			expect(getReturnableBadgeLabel(false)).toBe('แจกจ่าย');
			expect(getReturnableBadgeLabel(undefined)).toBe('แจกจ่าย');
		});

		it('maps returnable=true to "ต้องคืน"', () => {
			expect(getReturnableBadgeLabel(true)).toBe('ต้องคืน');
		});

		it('provides distinct Civic Design System classes for returnable vs consumable', () => {
			const consumableClass = getReturnableBadgeClass(false);
			const returnableClass = getReturnableBadgeClass(true);

			expect(consumableClass).toContain('emerald');
			expect(returnableClass).toContain('sky');
		});
	});
});
