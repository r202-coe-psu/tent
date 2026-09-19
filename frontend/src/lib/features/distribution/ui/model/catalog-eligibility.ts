import type { ItemMaster } from '$lib/features/catalog';
import type { Flow2RequisitionType } from '../../domain/food-supplies';

/**
 * Authoritative category IDs and system keys (CR-119 / CR-121).
 */
export const READY_MEAL_CATEGORY_ID = 'item_category:ready_meal';
export const READY_MEAL_SYSTEM_KEY = 'READY_MEAL';

export const KITCHEN_FOOD_CATEGORY_ID = 'item_category:food';
export const KITCHEN_FOOD_SYSTEM_KEY = 'FOOD';

/**
 * Checks if a category string or system key represents prepared ready-to-eat meals.
 */
export function isReadyMealCategory(category?: string): boolean {
	if (!category) return false;
	return (
		category === READY_MEAL_CATEGORY_ID ||
		category === READY_MEAL_SYSTEM_KEY ||
		category === 'ready_meal'
	);
}

/**
 * Checks if a category string or system key represents raw/kitchen food ingredients.
 */
export function isKitchenFoodCategory(category?: string): boolean {
	if (!category) return false;
	return (
		category === KITCHEN_FOOD_CATEGORY_ID ||
		category === KITCHEN_FOOD_SYSTEM_KEY ||
		category === 'food'
	);
}

/**
 * Checks if a category is any food-class category (either ready-meal or raw food).
 */
export function isAnyFoodCategory(category?: string): boolean {
	return isReadyMealCategory(category) || isKitchenFoodCategory(category);
}

/**
 * Evaluates whether an ItemMaster is eligible for a given requisition type.
 *
 * Rules:
 * - Food Ticket:
 *   - Category MUST be ready_meal (READY_MEAL) only.
 *   - Kitchen raw ingredients (FOOD) are STRICTLY FORBIDDEN.
 *   - General supplies are FORBIDDEN.
 *   - Must be type_class: 'CONSUMABLE'.
 *   - Must not be returnable.
 *
 * - Supplies Ticket:
 *   - MUST EXCLUDE all food categories (ready_meal and kitchen food).
 *   - Allows non-food relief supplies and equipment (DURABLE, EQUIPMENT, or non-food CONSUMABLE).
 *
 * Returns false if the item is deactivated.
 */
export function isEligibleDistributionCatalogItem(
	item: ItemMaster,
	requisitionType: Flow2RequisitionType
): boolean {
	if (item.deactivated) {
		return false;
	}

	if (requisitionType === 'food') {
		// Food tickets accept ONLY ready meals
		if (!isReadyMealCategory(item.category)) {
			return false;
		}
		// Kitchen raw food is strictly rejected
		if (isKitchenFoodCategory(item.category)) {
			return false;
		}
		// Ready meals must be consumable and non-returnable
		if (item.type_class !== 'CONSUMABLE' || item.returnable === true) {
			return false;
		}
		return true;
	}

	if (requisitionType === 'supplies') {
		// Supplies tickets MUST exclude ALL food categories
		if (isAnyFoodCategory(item.category)) {
			return false;
		}
		return true;
	}

	return false;
}

/**
 * Read-only Thai label derived strictly from catalog `returnable`.
 * Operators cannot toggle this.
 */
export function getReturnableBadgeLabel(returnable?: boolean): string {
	return returnable === true ? 'ต้องคืน' : 'แจกจ่าย';
}

/**
 * Civic Light Design System badge style for returnable vs consumable.
 */
export function getReturnableBadgeClass(returnable?: boolean): string {
	return returnable === true
		? 'border border-sky-200 bg-sky-50 text-sky-900 font-semibold'
		: 'border border-emerald-200 bg-emerald-50 text-emerald-900 font-semibold';
}
