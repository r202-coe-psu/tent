/**
 * Canonical Decimal quantity helpers for transactional ticket creation and allocation UI.
 * Enforces positive whole-number (integer item count) invariants for distribution workflows.
 * Uses textual Decimal-string semantics and avoids floating-point coercion.
 */

import type { ItemMaster } from '$lib/features/catalog';
import {
	validateWholeItemInput,
	positiveWholeQtySchema,
	type WholeItemValidationResult,
	type WholeItemValidationOptions
} from '../../domain/food-supplies';

export { validateWholeItemInput, type WholeItemValidationResult, type WholeItemValidationOptions };

export interface QuantityValidationResult {
	isValid: boolean;
	value?: string;
	error?: string;
}

/** Tests whether a raw string represents a valid positive whole number. */
export function isPositiveIntegerString(raw: string): boolean {
	return positiveWholeQtySchema.safeParse(raw).success;
}

/**
 * Validates and canonicalizes user-entered positive whole-item quantity.
 *
 * Guarantees:
 * - Normalizes redundant leading zeros (e.g. '050' -> '50').
 * - No floating-point conversion.
 * - Preserves precision for arbitrarily large integers (> Number.MAX_SAFE_INTEGER).
 * - Strictly rejects non-numeric strings, NaN, Infinity, empty/whitespace, zero, negative values,
 *   and scientific notation (1e2, 1E2).
 * - Rejects decimal notation, including values such as "2.0".
 */
export function validatePositiveQuantity(
	raw: string,
	options?: { allowZero?: boolean }
): QuantityValidationResult {
	const result = validateWholeItemInput(raw, options);
	if (!result.isValid || !result.value) {
		return {
			isValid: false,
			error: result.error ?? 'จำนวนต้องเป็นจำนวนเต็มที่ถูกต้อง'
		};
	}

	return {
		isValid: true,
		value: result.value
	};
}

export const validateIntegerQuantity = validatePositiveQuantity;

/**
 * Constructs a single canonical ticket item for CreateTicketDialog.
 * Ensures requested_qty and initial allocated_qty are identical positive whole-number Decimal strings.
 */
export function buildCreateTicketItem(item: { master: ItemMaster; requested_qty: string }): {
	item_id: string;
	item_name: string;
	category?: string;
	type_class: ItemMaster['type_class'];
	returnable?: boolean;
	requested_qty: string;
	allocated_qty: string;
} {
	const res = validatePositiveQuantity(item.requested_qty);
	if (!res.isValid || !res.value) {
		throw new Error(
			res.error
				? `จำนวนเบิกของ ${item.master.name}: ${res.error}`
				: `จำนวนเบิกของ ${item.master.name} ต้องเป็นจำนวนเต็มที่ถูกต้อง`
		);
	}
	return {
		item_id: item.master._id,
		item_name: item.master.name,
		category: item.master.category,
		type_class: item.master.type_class,
		returnable: item.master.returnable,
		requested_qty: res.value,
		allocated_qty: res.value
	};
}

/**
 * Constructs a single allocation item for TicketAllocationDialog.
 * Ensures allocated_qty is a canonical positive whole-number Decimal string without precision loss.
 */
export function buildAllocationItem(
	item: { item_id: string; item_name?: string },
	rawQty: string
): { item_id: string; allocated_qty: string } {
	const res = validatePositiveQuantity(rawQty);
	if (!res.isValid || !res.value) {
		throw new Error(
			res.error
				? `จำนวนจัดสรรของ ${item.item_name || item.item_id}: ${res.error}`
				: `จำนวนจัดสรรของ ${item.item_name || item.item_id} ต้องเป็นจำนวนเต็มที่ถูกต้อง`
		);
	}
	return {
		item_id: item.item_id,
		allocated_qty: res.value
	};
}
