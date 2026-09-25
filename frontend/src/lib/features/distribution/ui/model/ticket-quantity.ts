/**
 * Canonical Decimal quantity helpers for transactional ticket creation and allocation UI.
 * Strictly prevents IEEE-754 precision loss by avoiding parseFloat / Number / parseInt.
 */

import { qtyStrCoercePositiveSchema } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';

export interface QuantityValidationResult {
	isValid: boolean;
	value?: string;
	error?: string;
}

/**
 * Validates and canonicalizes user-entered quantity string for transactional ticket operations
 * (ticket item request, allocation, or catalog picker).
 *
 * Guarantees:
 * - Pure Decimal math via `persistQty` and canonical Zod schema.
 * - ZERO IEEE-754 `parseFloat` / `Number` / `parseInt` conversion.
 * - Preserves precision for arbitrary large integers (> Number.MAX_SAFE_INTEGER).
 * - Preserves fractional precision up to canonical QTY_DECIMALS (4 places).
 * - Canonicalizes formatting (e.g. removes leading zeros, redundant trailing zeros).
 * - Strictly rejects non-numeric strings, NaN, Infinity, empty/whitespace, zero, and negative values.
 */
export function validatePositiveQuantity(raw: string): QuantityValidationResult {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { isValid: false, error: 'กรุณาระบุจำนวน' };
	}

	const parsed = qtyStrCoercePositiveSchema.safeParse(trimmed);
	if (!parsed.success) {
		return {
			isValid: false,
			error: 'จำนวนต้องมากกว่า 0'
		};
	}

	return {
		isValid: true,
		value: parsed.data
	};
}

/**
 * Constructs a single canonical ticket item for CreateTicketDialog.
 * Ensures requested_qty and initial allocated_qty are identical canonical Decimal strings.
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
		throw new Error(`จำนวนเบิกของ ${item.master.name} ต้องมากกว่า 0`);
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
 * Ensures allocated_qty is a canonical Decimal string without precision loss.
 */
export function buildAllocationItem(
	item: { item_id: string; item_name?: string },
	rawQty: string
): { item_id: string; allocated_qty: string } {
	const res = validatePositiveQuantity(rawQty);
	if (!res.isValid || !res.value) {
		throw new Error(`จำนวนจัดสรรของ ${item.item_name || item.item_id} ต้องมากกว่า 0`);
	}
	return {
		item_id: item.item_id,
		allocated_qty: res.value
	};
}
