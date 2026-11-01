import type { StockLedger } from '$lib/features/operations';
import {
	isExpiryPassed,
	isLotExpired,
	lotPriorityReason,
	planLotSplit,
	projectStockLotBalances,
	rankLotsForIssue,
	sortStockLotsByConsumptionOrder,
	type LotPriorityItem,
	type LotSplitPlan,
	type StockLotBalance
} from '$lib/features/operations';
import { parseQty, persistQty, qtyGt, qtyGte, subQty } from '$lib/utils/qty';

export interface EligiblePhysicalLot {
	lot_ref: string;
	lot_no?: string;
	expiry?: string;
	storage_zone?: string;
	note?: string;
	qty: string;
	unit: string;
	received_at: string;
	isExpired: boolean;
	hasSufficientQty: boolean;
	/** Why the lot sits at this position in the issue order (CR-143 FR-A6). */
	reason: string;
}

/**
 * Checks whether an ISO date or date string is expired relative to current reference time.
 */
export function isLotDateExpired(
	expiryDateStr: string | undefined,
	referenceDate: Date = new Date()
): boolean {
	return isExpiryPassed(expiryDateStr, referenceDate.getTime());
}

/** Per-lot remaining balances (> 0) of one item, projected from ledger history. */
export function getItemLotBalances(
	ledger: readonly StockLedger[] | undefined,
	itemId: string
): StockLotBalance[] {
	if (!ledger || ledger.length === 0 || !itemId) {
		return [];
	}

	let balances: StockLotBalance[];
	try {
		balances = projectStockLotBalances(ledger);
	} catch {
		// If historical ledger has an anomaly, filter directly for this item to preserve availability
		try {
			const itemLedger = ledger.filter((e) => e.item_id === itemId);
			balances = projectStockLotBalances(itemLedger);
		} catch {
			return [];
		}
	}

	// Filter for this item and positive remaining balance
	return balances.filter((lot) => lot.item_id === itemId && qtyGt(lot.qty, 0));
}

/**
 * Auto-allocation plan for one item (CR-143 §A): non-expired lots in weighted issue order,
 * split to cover `requiredQty`. Shared by the picker's auto button and by callers that
 * prefill a plan (CR-178).
 */
export function planAutoLotAllocation(
	ledger: readonly StockLedger[] | undefined,
	itemId: string,
	requiredQty: string,
	priorityMap: ReadonlyMap<string, LotPriorityItem>,
	nowMs: number = Date.now()
): LotSplitPlan {
	const balances = getItemLotBalances(ledger, itemId);
	const ranked = rankLotsForIssue(balances, priorityMap, nowMs, { excludeExpired: true });
	return planLotSplit(ranked, requiredQty, nowMs, priorityMap);
}

/**
 * Projects available physical lots from stock ledger history for a given item,
 * filters for positive balances, and sorts them by the weighted issue priority shared with
 * the stock page (CR-143 §A, FR-A5). `item` supplies shelf life / storage type; without it a
 * 365-day horizon is assumed. Expired lots are listed last and flagged, never ranked first.
 */
export function getEligiblePhysicalLots(
	ledger: readonly StockLedger[] | undefined,
	itemId: string,
	requiredQty: string = '0',
	referenceDate: Date = new Date(),
	item?: LotPriorityItem
): EligiblePhysicalLot[] {
	const itemLots = getItemLotBalances(ledger, itemId);
	if (itemLots.length === 0) return [];

	// Same ordering function as the stock page (FR-A5)
	const nowMs = referenceDate.getTime();
	const itemsById = new Map<string, LotPriorityItem>(item ? [[itemId, item]] : []);
	const sorted = sortStockLotsByConsumptionOrder(itemLots, itemsById, nowMs);

	return sorted.map((lot) => {
		const expiry = lot.lot?.expiry;
		const isExpired = isLotExpired(lot, nowMs, item);
		const hasSufficientQty = qtyGte(lot.qty, requiredQty);

		return {
			lot_ref: lot.lot_ref,
			lot_no: lot.lot?.lot_no,
			expiry,
			storage_zone: lot.lot?.storage_zone,
			note: lot.lot?.note,
			qty: lot.qty,
			unit: lot.unit,
			received_at: lot.received_at,
			isExpired,
			hasSufficientQty,
			reason: lotPriorityReason(lot, item, nowMs)
		};
	});
}

/**
 * Highest qty one lot's input may take: its own balance, capped by what the other lots have
 * not already covered (`allocatedQty` minus `othersQty`). Never negative.
 */
export function lotInputMax(lotQty: string, allocatedQty: string, othersQty: string): string {
	const room = qtyGt(allocatedQty, othersQty) ? subQty(allocatedQty, othersQty) : '0';
	return persistQty(parseQty(lotQty).lt(parseQty(room)) ? lotQty : room);
}
