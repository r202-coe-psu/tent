import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';

/**
 * Validates a positive quantity and returns its canonical `qty_str` representation.
 * Recipe quantities are persisted at the standard recipe yield, while the form
 * presents a per-potion amount.
 */
function positiveQty(value: QtyValue, field: string): string {
	const normalized = persistQty(value);
	if (!qtyGt(normalized, 0)) {
		throw new Error(`${field} must be greater than 0`);
	}
	return normalized;
}

/** Converts a persisted standard-recipe quantity into its per-potion draft value. */
export function quantityPerPotionFromPersisted(
	persistedQuantity: QtyValue,
	standardPortions: QtyValue
): string {
	const quantity = positiveQty(persistedQuantity, 'persistedQuantity');
	const portions = positiveQty(standardPortions, 'standardPortions');
	return positiveQty(parseQty(quantity).div(portions), 'quantityPerPotion');
}

/** Converts a per-potion form value into the persisted standard-recipe quantity. */
export function persistedQuantityFromPerPotion(
	quantityPerPotion: QtyValue,
	standardPortions: QtyValue
): string {
	const quantity = positiveQty(quantityPerPotion, 'quantityPerPotion');
	const portions = positiveQty(standardPortions, 'standardPortions');
	return positiveQty(parseQty(quantity).mul(portions), 'persistedQuantity');
}

/** Calculates the read-only total shown for a recipe's standard potion yield. */
export function totalQuantityForPotions(
	quantityPerPotion: QtyValue,
	standardPortions: QtyValue
): string {
	return persistedQuantityFromPerPotion(quantityPerPotion, standardPortions);
}
