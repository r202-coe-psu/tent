import { persistQty, qtyGt, qtyGte, addQty, subQty } from '$lib/utils/qty';
import type { DistributionRequest, DistributionRequestItem } from '../domain/distribution';
import type { DistributionAllocationInput } from '../data/distribution.repository';
import { sortStockLotsByConsumptionOrder, type StockLotBalance } from '$lib/features/operations';

export type AllocationItemStatus = 'unallocated' | 'partial' | 'full' | 'over';

export interface LotAllocationEntry {
	input_key: string;
	lot_ref: string;
	lot_no?: string;
	storage_zone?: string;
	expiry?: string;
	received_at: string;
	available_qty: string;
	allocated_qty: string;
	isOverLot: boolean;
}

export interface ItemAllocationPlan {
	row_index: number;
	row_key: string;
	item_id: string;
	requested_qty: string;
	unit: string;
	distribution_type_snapshot: 'consumable' | 'one_time';
	target_qty_snapshot: string;
	allocated_qty: string;
	remaining_qty: string;
	status: AllocationItemStatus;
	lotEntries: LotAllocationEntry[];
	isItemValid: boolean;
	errorMessage?: string;
}

export interface ApprovalPlanValidation {
	isValid: boolean;
	totalAllocatedQty: string;
	positiveAllocationsCount: number;
	isPartial: boolean;
	errors: string[];
}

/**
 * Returns a stable input key for a specific item row and physical lot.
 */
export function getLotInputKey(itemId: string, rowIndex: number, lotRef: string): string {
	return `${itemId}#${rowIndex}:${lotRef}`;
}

/**
 * Filters stock lots available for a specific item and delegates sorting to the
 * canonical Operations stock consumption ordering authority (FEFO / FIFO).
 */
export function filterLotsForItem(
	lots: readonly StockLotBalance[],
	itemId: string,
	unit?: string
): StockLotBalance[] {
	const matching = lots.filter(
		(lot) => lot.item_id === itemId && (unit ? lot.unit === unit : true) && qtyGt(lot.qty, 0)
	);
	return sortStockLotsByConsumptionOrder(matching);
}

/**
 * Calculates allocation stats for a single requested item row across its lot input values.
 */
export function calculateItemAllocation(
	reqItem: DistributionRequestItem,
	rowIndex: number,
	lotInputMap: Record<string, string>,
	availableLots: readonly StockLotBalance[]
): ItemAllocationPlan {
	const matchingLots = filterLotsForItem(availableLots, reqItem.item_id, reqItem.unit);

	let totalAllocated = '0';
	let hasLotOverAllocation = false;

	const lotEntries: LotAllocationEntry[] = matchingLots.map((lot) => {
		const inputKey = getLotInputKey(reqItem.item_id, rowIndex, lot.lot_ref);
		const rawInput = lotInputMap[inputKey] ?? lotInputMap[lot.lot_ref] ?? '';
		const trimmed = rawInput.trim();

		let parsedAllocated = '0';
		let isOverLot = false;

		if (trimmed !== '' && qtyGt(trimmed, 0)) {
			parsedAllocated = persistQty(trimmed);
			if (qtyGt(parsedAllocated, lot.qty)) {
				isOverLot = true;
				hasLotOverAllocation = true;
			}
		}

		totalAllocated = addQty(totalAllocated, parsedAllocated);

		return {
			input_key: inputKey,
			lot_ref: lot.lot_ref,
			lot_no: lot.lot?.lot_no,
			storage_zone: lot.lot?.storage_zone,
			expiry: lot.lot?.expiry,
			received_at: lot.received_at,
			available_qty: persistQty(lot.qty),
			allocated_qty: trimmed,
			isOverLot
		};
	});

	const reqQty = persistQty(reqItem.requested_qty);
	const isOverRequested = qtyGt(totalAllocated, reqQty);

	let status: AllocationItemStatus = 'unallocated';
	if (isOverRequested || hasLotOverAllocation) {
		status = 'over';
	} else if (qtyGte(totalAllocated, reqQty)) {
		status = 'full';
	} else if (qtyGt(totalAllocated, 0)) {
		status = 'partial';
	}

	const remaining_qty = qtyGt(reqQty, totalAllocated) ? subQty(reqQty, totalAllocated) : '0';

	let errorMessage: string | undefined;
	if (isOverRequested) {
		errorMessage = `จำนวนจัดสรร (${totalAllocated}) เกินจำนวนที่ร้องขอ (${reqQty})`;
	} else if (hasLotOverAllocation) {
		errorMessage = 'จำนวนจัดสรรเกินจำนวนคงเหลือในบาง Lot';
	}

	const isItemValid = !isOverRequested && !hasLotOverAllocation;

	return {
		row_index: rowIndex,
		row_key: `${reqItem.item_id}#${rowIndex}`,
		item_id: reqItem.item_id,
		requested_qty: reqQty,
		unit: reqItem.unit,
		distribution_type_snapshot: reqItem.distribution_type_snapshot,
		target_qty_snapshot: persistQty(reqItem.target_qty_snapshot),
		allocated_qty: totalAllocated,
		remaining_qty,
		status,
		lotEntries,
		isItemValid,
		errorMessage
	};
}

/**
 * Builds the full allocation plan for all items in a request.
 */
export function buildApprovalPlan(
	request: DistributionRequest,
	lotInputMap: Record<string, string>,
	availableLots: readonly StockLotBalance[]
): ItemAllocationPlan[] {
	return request.items.map((item, index) =>
		calculateItemAllocation(item, index, lotInputMap, availableLots)
	);
}

/**
 * Validates the entire approval plan across all items, enforcing both per-item request bounds
 * and global physical lot capacities across duplicate or distinct request rows.
 */
export function validateApprovalPlan(
	plans: ItemAllocationPlan[],
	availableLots: readonly StockLotBalance[] = []
): ApprovalPlanValidation {
	const errors: string[] = [];
	let totalAllocated = '0';
	let positiveAllocationsCount = 0;
	let hasPartialItem = false;
	let hasUnallocatedItem = false;

	const lotMap = new Map<string, StockLotBalance>();
	for (const lot of availableLots) {
		lotMap.set(lot.lot_ref, lot);
	}

	// 1. Track global allocations per physical lot across all plans
	const globalLotAllocations = new Map<string, string>();

	for (const plan of plans) {
		if (!plan.isItemValid && plan.errorMessage) {
			errors.push(`แถวที่ ${plan.row_index + 1} (${plan.item_id}): ${plan.errorMessage}`);
		}

		if (plan.status === 'partial') {
			hasPartialItem = true;
		} else if (plan.status === 'unallocated') {
			hasUnallocatedItem = true;
		}

		for (const entry of plan.lotEntries) {
			const trimmed = entry.allocated_qty.trim();
			if (trimmed !== '' && qtyGt(trimmed, 0)) {
				positiveAllocationsCount++;
				const parsed = persistQty(trimmed);
				totalAllocated = addQty(totalAllocated, parsed);

				const currentLotTotal = globalLotAllocations.get(entry.lot_ref) ?? '0';
				globalLotAllocations.set(entry.lot_ref, addQty(currentLotTotal, parsed));
			}
		}
	}

	// 2. Enforce global physical lot capacities across all rows
	for (const [lotRef, totalForLot] of globalLotAllocations) {
		const lot = lotMap.get(lotRef);
		if (lot && qtyGt(totalForLot, lot.qty)) {
			const label = lot.lot?.lot_no ? `Lot ${lot.lot.lot_no}` : lotRef;
			errors.push(
				`จำนวนจัดสรรรวมของ ${label} (${totalForLot}) เกินจำนวนคงเหลือในคลัง (${lot.qty})`
			);
		}
	}

	if (positiveAllocationsCount === 0) {
		errors.push('ต้องจัดสรรจำนวนอย่างน้อย 1 รายการเพื่ออนุมัติ');
	}

	const isValid = errors.length === 0 && positiveAllocationsCount > 0;
	const isPartial = hasPartialItem || hasUnallocatedItem;

	return {
		isValid,
		totalAllocatedQty: totalAllocated,
		positiveAllocationsCount,
		isPartial,
		errors
	};
}

/**
 * Normalizes user input into authoritative DistributionAllocationInput array for approveRequest.
 * Drops all empty/zero lines, aggregates duplicate item rows targeting the same physical lot,
 * and includes only positive allocations.
 */
export function buildApprovalAllocations(
	plans: ItemAllocationPlan[],
	availableLots: readonly StockLotBalance[]
): DistributionAllocationInput[] {
	const lotMap = new Map<string, StockLotBalance>();
	for (const lot of availableLots) {
		lotMap.set(lot.lot_ref, lot);
	}

	// Aggregate by unique (item_id, lot_ref)
	const aggregated = new Map<string, { item_id: string; lot_ref: string; qty: string }>();

	for (const plan of plans) {
		for (const entry of plan.lotEntries) {
			const trimmed = entry.allocated_qty.trim();
			if (trimmed === '' || !qtyGt(trimmed, 0)) continue;

			const normalizedQty = persistQty(trimmed);
			const key = `${plan.item_id}:${entry.lot_ref}`;
			const existing = aggregated.get(key);

			if (existing) {
				existing.qty = addQty(existing.qty, normalizedQty);
			} else {
				aggregated.set(key, {
					item_id: plan.item_id,
					lot_ref: entry.lot_ref,
					qty: normalizedQty
				});
			}
		}
	}

	const allocations: DistributionAllocationInput[] = [];
	for (const item of aggregated.values()) {
		const matchingLot = lotMap.get(item.lot_ref);
		allocations.push({
			item_id: item.item_id,
			lot_ref: item.lot_ref,
			qty: item.qty,
			...(matchingLot?.lot
				? {
						lot: {
							...(matchingLot.lot.expiry ? { expiry: matchingLot.lot.expiry } : {}),
							...(matchingLot.lot.lot_no ? { lot_no: matchingLot.lot.lot_no } : {}),
							...(matchingLot.lot.storage_zone
								? { storage_zone: matchingLot.lot.storage_zone }
								: {}),
							...(matchingLot.lot.note ? { note: matchingLot.lot.note } : {})
						}
					}
				: {})
		});
	}

	return allocations;
}
