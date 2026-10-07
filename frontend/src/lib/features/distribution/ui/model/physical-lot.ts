import type { StockLedger } from '$lib/features/operations';
import {
	isLotExpired,
	lotPriorityReason,
	projectStockLotBalances,
	sortStockLotsByConsumptionOrder,
	type LotPriorityItem,
	type StockLotBalance
} from '$lib/features/operations';
import { qtyGt, qtyGte } from '$lib/utils/qty';

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
	if (!expiryDateStr) return false;
	const expiry = new Date(expiryDateStr);
	if (isNaN(expiry.getTime())) return false;
	// FR-A4: a lot whose expiry is at or before now is expired.
	return expiry.getTime() <= referenceDate.getTime();
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
	const itemLots = balances.filter((lot) => lot.item_id === itemId && qtyGt(lot.qty, 0));

	// Same ordering function as the stock page (FR-A5)
	const nowMs = referenceDate.getTime();
	const itemsById = new Map<string, LotPriorityItem>(item ? [[itemId, item]] : []);
	const sorted = sortStockLotsByConsumptionOrder(itemLots, itemsById, nowMs);

	return sorted.map((lot) => {
		const expiry = lot.lot?.expiry;
		const isExpired = isLotExpired(lot, nowMs);
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
