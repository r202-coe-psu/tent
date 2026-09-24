import {
	addQty,
	parseQty,
	persistQty,
	qtyGt,
	qtyLte,
	qtyStrNonNegativeSchema,
	subQty
} from '$lib/utils/qty';
import type {
	ItemReconciliationSummary,
	ShiftCloseOptions
} from '../../application/food-supplies/reconciliation-workflow';

export interface ItemReconciliationPreview {
	itemId: string;
	itemName: string;
	allocated: string;
	distributed: string;
	remainingInHand: string;
	returned: string;
	discrepancy: string;
	hasDiscrepancy: boolean;
}

export interface ShiftClosePreview {
	totalAllocated: string;
	totalDistributed: string;
	totalRemainingInHand: string;
	totalReturned: string;
	totalDiscrepancy: string;
	hasPhysicalReturns: boolean;
	isZeroReturnFastPath: boolean;
	hasDiscrepancy: boolean;
	itemPreviews: ItemReconciliationPreview[];
}

export interface ReturnedQtyValidationResult {
	isValid: boolean;
	normalized?: string;
	error?: string;
}

export interface ShiftCloseFormValidationResult {
	isValid: boolean;
	errors: Record<string, string>;
	normalizedValues?: Record<string, string>;
}

/**
 * Initializes editable returned quantities from each item's current remaining_in_hand.
 */
export function initializeReturnedQuantities(
	summaries: ItemReconciliationSummary[]
): Record<string, string> {
	const result: Record<string, string> = {};
	for (const item of summaries) {
		result[item.item_id] = item.remaining_in_hand || '0';
	}
	return result;
}

/**
 * Validates a single returned quantity string against canonical rules:
 * - Must be a valid decimal string
 * - Must be >= 0
 * - Must be <= remaining_in_hand
 */
export function validateReturnedQuantity(
	raw: string,
	remainingInHand: string
): ReturnedQtyValidationResult {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { isValid: false, error: 'กรุณาระบุจำนวนส่งคืน' };
	}

	const parsed = qtyStrNonNegativeSchema.safeParse(trimmed);
	if (!parsed.success) {
		try {
			const dec = parseQty(trimmed);
			if (dec.isNegative()) {
				return { isValid: false, error: 'จำนวนส่งคืนต้องไม่ติดลบ (≥ 0)' };
			}
		} catch {
			// Ignore parse error; drop through
		}
		return { isValid: false, error: 'จำนวนต้องเป็นตัวเลขที่ถูกต้อง' };
	}

	const normalized = parsed.data;
	const safeRemaining = persistQty(remainingInHand || '0');

	if (!qtyLte(normalized, safeRemaining)) {
		return {
			isValid: false,
			error: `จำนวนส่งคืน (${normalized}) ต้องไม่เกินจำนวนคงเหลือในมือ (${safeRemaining})`
		};
	}

	return { isValid: true, normalized };
}

/**
 * Validates the complete shift close form across all item summaries.
 */
export function validateShiftCloseForm(
	summaries: ItemReconciliationSummary[],
	formValues: Record<string, string>
): ShiftCloseFormValidationResult {
	const errors: Record<string, string> = {};
	const normalizedValues: Record<string, string> = {};
	let isValid = true;

	for (const item of summaries) {
		const raw = formValues[item.item_id] ?? '';
		const result = validateReturnedQuantity(raw, item.remaining_in_hand);
		if (!result.isValid || !result.normalized) {
			isValid = false;
			errors[item.item_id] = result.error ?? 'จำนวนไม่ถูกต้อง';
		} else {
			normalizedValues[item.item_id] = result.normalized;
		}
	}

	return {
		isValid,
		errors,
		...(isValid ? { normalizedValues } : {})
	};
}

/**
 * Computes presentation preview for a single item.
 * discrepancy = allocated - (distributed + returned) = remainingInHand - returned
 */
export function computeItemPreview(
	item: ItemReconciliationSummary,
	returnedQtyInput: string
): ItemReconciliationPreview {
	const safeReturned = qtyStrNonNegativeSchema.safeParse(returnedQtyInput.trim()).success
		? persistQty(returnedQtyInput.trim())
		: '0';

	const allocated = persistQty(item.allocated_qty || '0');
	const distributed = persistQty(item.distributed_qty || '0');
	const remainingInHand = persistQty(item.remaining_in_hand || '0');

	const accounted = addQty(distributed, safeReturned);
	const discrepancy = qtyGt(accounted, allocated) ? '0' : subQty(allocated, accounted);

	return {
		itemId: item.item_id,
		itemName: item.item_name,
		allocated,
		distributed,
		remainingInHand,
		returned: safeReturned,
		discrepancy,
		hasDiscrepancy: qtyGt(discrepancy, 0)
	};
}

/**
 * Derives comprehensive reconciliation preview and lifecycle paths.
 */
export function computeShiftClosePreview(
	summaries: ItemReconciliationSummary[],
	formValues: Record<string, string>
): ShiftClosePreview {
	let totalAllocated = '0';
	let totalDistributed = '0';
	let totalRemainingInHand = '0';
	let totalReturned = '0';
	let totalDiscrepancy = '0';

	const itemPreviews: ItemReconciliationPreview[] = summaries.map((item) => {
		const rawReturned = formValues[item.item_id] ?? item.remaining_in_hand ?? '0';
		const preview = computeItemPreview(item, rawReturned);

		totalAllocated = addQty(totalAllocated, preview.allocated);
		totalDistributed = addQty(totalDistributed, preview.distributed);
		totalRemainingInHand = addQty(totalRemainingInHand, preview.remainingInHand);
		totalReturned = addQty(totalReturned, preview.returned);
		totalDiscrepancy = addQty(totalDiscrepancy, preview.discrepancy);

		return preview;
	});

	const hasPhysicalReturns = qtyGt(totalReturned, 0);
	const isZeroReturnFastPath = !hasPhysicalReturns;
	const hasDiscrepancy = qtyGt(totalDiscrepancy, 0);

	return {
		totalAllocated,
		totalDistributed,
		totalRemainingInHand,
		totalReturned,
		totalDiscrepancy,
		hasPhysicalReturns,
		isZeroReturnFastPath,
		hasDiscrepancy,
		itemPreviews
	};
}

/**
 * Constructs ShiftCloseOptions with explicit returned_quantities for all applicable items.
 */
export function buildCloseShiftOptions(
	normalizedValues: Record<string, string>
): ShiftCloseOptions {
	return {
		returned_quantities: { ...normalizedValues }
	};
}
