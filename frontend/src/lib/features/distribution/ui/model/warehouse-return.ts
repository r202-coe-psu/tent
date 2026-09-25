import {
	addQty,
	parseQty,
	persistQty,
	qtyGt,
	qtyLte,
	qtyStrNonNegativeSchema,
	subQty
} from '$lib/utils/qty';
import type { AuthorContext } from '$lib/db/model';
import type { RequisitionTicket, TicketItem } from '../../domain/food-supplies';
import { normalizeWholeItemInput } from '../../domain/food-supplies';
import type { VerifiedWarehouseReturns } from '../../application/food-supplies/reconciliation-workflow';
import { canReceiveWarehouseReturns } from '../../application/food-supplies/auth';

export interface WarehouseReturnItemPreview {
	itemId: string;
	itemName: string;
	allocated: string;
	distributed: string;
	frontlineReturned: string;
	verifiedReturned: string;
	discrepancy: string;
	hasDiscrepancy: boolean;
	isValid: boolean;
	error?: string;
}

export interface WarehouseReturnSummaryPreview {
	totalAllocated: string;
	totalDistributed: string;
	totalFrontlineReturned: string;
	totalVerifiedReturned: string;
	totalDiscrepancy: string;
	hasDiscrepancy: boolean;
	isValid: boolean;
	itemPreviews: WarehouseReturnItemPreview[];
}

export interface VerifiedQtyValidationResult {
	isValid: boolean;
	normalized?: string;
	wasNormalized?: boolean;
	error?: string;
}

export interface WarehouseReturnFormValidationResult {
	isValid: boolean;
	errors: Record<string, string>;
	normalizedValues?: Record<string, string>;
}

/**
 * Initializes warehouse verified quantities from each item's frontline-declared returned_qty.
 * Initial assumption: warehouse receives what frontline sent.
 */
export function initializeVerifiedQuantities(items: TicketItem[]): Record<string, string> {
	const result: Record<string, string> = {};
	for (const item of items) {
		result[item.item_id] = item.returned_qty ?? '0';
	}
	return result;
}

/**
 * Validates a single verified quantity string against canonical rules:
 * - Must be a valid whole-item quantity (normalizes decimal with ceiling)
 * - Must be >= 0 (allowZero: true)
 * - Must be <= item.returned_qty sent by frontline (warehouse cannot increase returns)
 */
export function validateVerifiedQuantity(
	raw: string,
	frontlineDeclared: string
): VerifiedQtyValidationResult {
	const trimmed = raw.trim();
	if (!trimmed) {
		return { isValid: false, error: 'กรุณาระบุจำนวนตรวจรับ' };
	}

	const norm = normalizeWholeItemInput(trimmed, { allowZero: true });
	if (!norm.isValid || norm.normalized === null) {
		return { isValid: false, error: norm.error ?? 'จำนวนต้องเป็นตัวเลขที่ถูกต้อง' };
	}

	const normalized = norm.normalized;
	const safeDeclared = persistQty(frontlineDeclared || '0');

	if (!qtyLte(normalized, safeDeclared)) {
		return {
			isValid: false,
			error: `จำนวนตรวจรับ (${normalized}) ต้องไม่เกินจำนวนที่จุดแจกแจ้งส่งคืน (${safeDeclared})`,
			normalized,
			wasNormalized: norm.wasNormalized
		};
	}

	return { isValid: true, normalized, wasNormalized: norm.wasNormalized };
}

/**
 * Validates the complete warehouse return form across all ticket items.
 */
export function validateWarehouseReturnForm(
	items: TicketItem[],
	formValues: Record<string, string>
): WarehouseReturnFormValidationResult {
	const errors: Record<string, string> = {};
	const normalizedValues: Record<string, string> = {};
	let isValid = true;

	for (const item of items) {
		const raw = formValues[item.item_id] ?? '';
		const result = validateVerifiedQuantity(raw, item.returned_qty ?? '0');
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
 * Computes accounting preview for a single item under dockside verification:
 * discrepancy = (allocated - distributed) - verifiedReturned
 */
export function computeWarehouseItemPreview(
	item: TicketItem,
	verifiedQtyInput: string
): WarehouseReturnItemPreview {
	const declared = item.returned_qty ?? '0';
	const validation = validateVerifiedQuantity(verifiedQtyInput, declared);

	const safeVerified = validation.isValid && validation.normalized ? validation.normalized : '0';

	const allocated = persistQty(item.allocated_qty || '0');
	const distributed = persistQty(item.distributed_qty || '0');
	const frontlineReturned = persistQty(declared);

	const remainingAfterDistribution = subQty(allocated, distributed);
	const discrepancy = qtyGt(safeVerified, remainingAfterDistribution)
		? '0'
		: subQty(remainingAfterDistribution, safeVerified);

	return {
		itemId: item.item_id,
		itemName: item.item_name,
		allocated,
		distributed,
		frontlineReturned,
		verifiedReturned: safeVerified,
		discrepancy,
		hasDiscrepancy: qtyGt(discrepancy, 0),
		isValid: validation.isValid,
		error: validation.error
	};
}

/**
 * Derives comprehensive summary preview for warehouse physical return verification.
 */
export function computeWarehouseReturnSummary(
	items: TicketItem[],
	formValues: Record<string, string>
): WarehouseReturnSummaryPreview {
	let totalAllocated = '0';
	let totalDistributed = '0';
	let totalFrontlineReturned = '0';
	let totalVerifiedReturned = '0';
	let totalDiscrepancy = '0';
	let allValid = true;

	const itemPreviews: WarehouseReturnItemPreview[] = items.map((item) => {
		const rawInput = formValues[item.item_id] ?? item.returned_qty ?? '0';
		const preview = computeWarehouseItemPreview(item, rawInput);

		totalAllocated = addQty(totalAllocated, preview.allocated);
		totalDistributed = addQty(totalDistributed, preview.distributed);
		totalFrontlineReturned = addQty(totalFrontlineReturned, preview.frontlineReturned);
		totalVerifiedReturned = addQty(totalVerifiedReturned, preview.verifiedReturned);
		totalDiscrepancy = addQty(totalDiscrepancy, preview.discrepancy);

		if (!preview.isValid) {
			allValid = false;
		}

		return preview;
	});

	return {
		totalAllocated,
		totalDistributed,
		totalFrontlineReturned,
		totalVerifiedReturned,
		totalDiscrepancy,
		hasDiscrepancy: qtyGt(totalDiscrepancy, 0),
		isValid: allValid,
		itemPreviews
	};
}

/**
 * Builds explicit verified_returned_quantities payload for receiveWarehouseReturns mutation.
 */
export function buildVerifiedReturnsPayload(
	normalizedValues: Record<string, string>
): VerifiedWarehouseReturns {
	return {
		verified_returned_quantities: { ...normalizedValues }
	};
}

/**
 * Checks if the warehouse return verification action button should be visible.
 * Rule: status MUST be RETURN_PENDING_RECEIPT and actor must have canReceiveWarehouseReturns.
 */
export function canShowWarehouseReceiveAction(
	ticket: RequisitionTicket,
	ctx: AuthorContext | null
): boolean {
	if (!ctx) return false;
	if (ticket.status !== 'RETURN_PENDING_RECEIPT') return false;
	return canReceiveWarehouseReturns(ctx);
}

/**
 * Checks if the ticket completion action button should be visible in back-office UI.
 * Rule: status MUST be RETURN_COMPLETED and actor must have canReceiveWarehouseReturns.
 * SHIFT_CLOSED recovery path is NOT exposed in standard UI.
 */
export function canShowCompleteTicketAction(
	ticket: RequisitionTicket,
	ctx: AuthorContext | null
): boolean {
	if (!ctx) return false;
	if (ticket.status !== 'RETURN_COMPLETED') return false;
	return canReceiveWarehouseReturns(ctx);
}
