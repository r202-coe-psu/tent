/**
 * Canonical Decimal quantity helpers for transactional ticket creation and allocation UI.
 * Enforces positive whole-number (integer item count) invariants for distribution workflows.
 * Strictly prevents IEEE-754 precision loss by avoiding parseFloat / Number / parseInt.
 */

import { persistQty } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';
import {
	normalizeWholeItemInput,
	type WholeItemNormalizationResult,
	type WholeItemNormalizationOptions
} from '../../domain/food-supplies';

export {
	normalizeWholeItemInput,
	type WholeItemNormalizationResult,
	type WholeItemNormalizationOptions
};

export interface QuantityValidationResult {
	isValid: boolean;
	value?: string;
	error?: string;
	wasNormalized?: boolean;
	originalValue?: string;
}

/** Matches positive whole numbers with optional leading zeros (no decimals, no sign, no scientific notation). */
const POSITIVE_INTEGER_RE = /^0*([1-9]\d*)$/;

/** Tests whether a raw string represents a valid positive whole number. */
export function isPositiveIntegerString(raw: string): boolean {
	return POSITIVE_INTEGER_RE.test(raw.trim());
}

/**
 * Formats user-friendly Thai feedback when a quantity is normalized (ceiling-rounded).
 * E.g. "จำนวนต้องเป็นจำนวนเต็ม ระบบปรับจาก 1.5 เป็น 2"
 */
export function formatNormalizationNotice(
	original: string,
	normalized: string,
	unit?: string
): string {
	const unitSuffix = unit ? ` ${unit}` : '';
	return `จำนวนต้องเป็นจำนวนเต็ม ระบบปรับจาก ${original} เป็น ${normalized}${unitSuffix}`;
}

/**
 * Validates and canonicalizes user-entered quantity string for transactional ticket operations
 * (ticket item request, allocation, or catalog picker).
 *
 * Guarantees:
 * - Automatically normalizes valid positive decimals by ALWAYS ROUNDING UP (Ceiling).
 * - Normalizes redundant leading zeros (e.g. '050' -> '50').
 * - ZERO IEEE-754 `parseFloat` / `Number` / `parseInt` conversion.
 * - Preserves precision for arbitrarily large integers (> Number.MAX_SAFE_INTEGER).
 * - Strictly rejects non-numeric strings, NaN, Infinity, empty/whitespace, zero, negative values,
 *   and scientific notation (1e2, 1E2).
 * - Clear Thai validation message: "จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป".
 */
export function validatePositiveQuantity(
	raw: string,
	options?: { allowZero?: boolean }
): QuantityValidationResult {
	const norm = normalizeWholeItemInput(raw, options);
	if (!norm.isValid || !norm.value) {
		return {
			isValid: false,
			error: norm.error ?? 'จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป'
		};
	}

	return {
		isValid: true,
		value: norm.value,
		wasNormalized: norm.wasNormalized,
		originalValue: (raw ?? '').trim()
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
				: `จำนวนเบิกของ ${item.master.name} ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`
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
				: `จำนวนจัดสรรของ ${item.item_name || item.item_id} ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`
		);
	}
	return {
		item_id: item.item_id,
		allocated_qty: res.value
	};
}
