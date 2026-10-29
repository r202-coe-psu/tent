import { parseQty, persistQty, qtyGt, type QtyValue } from '$lib/utils/qty';

/** True when the value is greater than 0 at stored qty precision. */
export function isPositiveQty(value: QtyValue): boolean {
	return qtyGt(persistQty(value), 0);
}

/**
 * Validates a positive quantity and returns its canonical `qty_str` representation.
 * Recipe quantities are persisted at the standard recipe yield, while the form
 * presents a per-potion amount.
 */
function positiveQty(value: QtyValue, field: string): string {
	const normalized = persistQty(value);
	if (!isPositiveQty(normalized)) {
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

/** Rescales a quantity sized for `fromPortions` to `toPortions`; may round to `'0'`. */
export function scaleQuantityToPortions(
	quantity: QtyValue,
	fromPortions: QtyValue,
	toPortions: QtyValue
): string {
	const amount = positiveQty(quantity, 'quantity');
	const from = positiveQty(fromPortions, 'fromPortions');
	const to = positiveQty(toPortions, 'toPortions');
	return persistQty(parseQty(amount).mul(to).div(from));
}

/** Calculates the read-only total shown for a recipe's standard potion yield. */
export function totalQuantityForPotions(
	quantityPerPotion: QtyValue,
	standardPortions: QtyValue
): string {
	return persistedQuantityFromPerPotion(quantityPerPotion, standardPortions);
}
