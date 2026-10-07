/**
 * Multi-lot issue planning (CR-143 §A, FR-A7, FR-A11).
 *
 * Pure: no I/O, no Svelte. Given lots already in issue order (from
 * `rankLotsForIssue`), split a requested quantity across them until it is met.
 * Expired lots (FR-A4) are never planned; quantities are base-unit decimal
 * strings and stay exact (`$lib/utils/qty`).
 */

import { addQty, qtyGt, qtyGte, qtyIsZero, subQty, type QtyValue } from '$lib/utils/qty';
import { isLotExpired, type LotPriorityItem } from './lot-priority';
import type { StockLotBalance } from './operations';

/** The lot fields the planner reads. */
export type SplittableLot = Pick<StockLotBalance, 'lot_ref' | 'qty' | 'lot' | 'unit'> & {
	/** Needed with `priorityItems` to apply the shelf-life rule (CR-156 FR-A4a). */
	item_id?: string;
	received_at?: string;
};

/** One ledger row the plan will write: take `qty` out of one lot. */
export interface LotAllocation<T extends SplittableLot = StockLotBalance> {
	lot: T;
	lot_ref: string;
	/** Base-unit quantity to take from this lot (always > 0, never more than the lot holds). */
	qty: string;
}

export interface LotSplitPlan<T extends SplittableLot = StockLotBalance> {
	allocations: LotAllocation<T>[];
	/** Sum of the allocations. */
	planned: string;
	/** What the request still lacks once every usable lot is spent (`0` when the plan is complete). */
	shortfall: string;
	/** Total held by the usable (non-expired, qty > 0) lots — what to show when short (FR-A11). */
	available: string;
	/** Expired lots that were skipped (FR-A4); the UI tells the user to adjust them out. */
	skippedExpired: T[];
	/** `true` when the plan covers the whole request, so it may be saved. */
	complete: boolean;
}

/**
 * FR-A7: walk `rankedLots` in order, taking from each until `qty` is covered.
 * Expired lots are skipped (FR-A4) and empty ones ignored. A non-positive `qty`
 * yields an empty, incomplete plan — there is nothing to issue.
 *
 * Pass `priorityItems` (item id → shelf life / storage type) so a lot with no expiry whose
 * `shelf_life_days` is used up counts as expired too (CR-156 FR-A4a), as on the stock page.
 */
export function planLotSplit<T extends SplittableLot>(
	rankedLots: readonly T[],
	qty: QtyValue,
	now: number,
	priorityItems?: ReadonlyMap<string, LotPriorityItem>
): LotSplitPlan<T> {
	const skippedExpired: T[] = [];
	const usable: T[] = [];
	for (const lot of rankedLots) {
		if (!qtyGt(lot.qty, 0)) continue;
		if (isLotExpired(lot, now, lot.item_id ? priorityItems?.get(lot.item_id) : undefined))
			skippedExpired.push(lot);
		else usable.push(lot);
	}
	const available = usable.reduce((sum, lot) => addQty(sum, lot.qty), '0');

	const allocations: LotAllocation<T>[] = [];
	let planned = '0';
	if (qtyGt(qty, 0)) {
		let left = addQty(qty, 0);
		for (const lot of usable) {
			if (qtyIsZero(left)) break;
			const take = qtyGte(lot.qty, left) ? left : lot.qty;
			allocations.push({ lot, lot_ref: lot.lot_ref, qty: take });
			planned = addQty(planned, take);
			left = subQty(left, take);
		}
	}

	const shortfall = qtyGt(qty, 0) ? subQty(qty, planned) : '0';
	return {
		allocations,
		planned,
		shortfall,
		available,
		skippedExpired,
		complete: qtyGt(qty, 0) && qtyIsZero(shortfall)
	};
}
