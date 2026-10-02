import Decimal from 'decimal.js';
import { calculateReorderLevel } from '$lib/features/supply/domain/threshold-calc';
import { qtyGt, qtyLte, addQty } from '$lib/utils/qty';
import type { StockLedger, StockLotBalance } from './operations';
import { lotStorageKey } from './lot-storage';

/** Days before expiry at which a lot counts as "expiring soon". */
export const EXPIRING_SOON_DAYS = 7;

const DAY_MS = 86_400_000;

/** Quantity status against the reorder threshold (expiry is tracked separately). */
export type StockQtyStatus = 'normal' | 'low' | 'empty';

/** Expiry state of an item, judged on its earliest-expiring remaining lot. */
export type StockExpiryState = 'expired' | 'expiring' | 'ok' | 'none';

export interface ItemStockSummary {
	/** Earliest `lot.expiry` across every lot that still holds stock — expired ones included. */
	earliestExpiry: string | null;
	expiryState: StockExpiryState;
	/** Lots with qty > 0. */
	lotCount: number;
	/** Distinct {@link lotStorageKey} values of lots with qty > 0 ('' = unspecified). */
	storageKeys: string[];
	/** Sum of qty in lots whose expiry has passed. */
	expiredQty: string;
	/** `received_at` of the oldest lot still holding stock. */
	oldestReceivedAt: string | null;
}

/**
 * Summarise one item's remaining lots. Looks at every lot with qty > 0, so an
 * old lot that is about to expire is not hidden by a newer receipt.
 */
export function summarizeItemStock(
	lots: readonly StockLotBalance[],
	now: number = Date.now(),
	expiringWithinDays: number = EXPIRING_SOON_DAYS
): ItemStockSummary {
	const remaining = lots.filter((l) => qtyGt(l.qty, 0));
	let earliestExpiry: string | null = null;
	let earliestExpiryMs = Infinity;
	let oldestReceivedAt: string | null = null;
	let expiredQty = '0';
	const storageKeys = new Set<string>();

	for (const lot of remaining) {
		storageKeys.add(lotStorageKey(lot.lot));
		if (!oldestReceivedAt || lot.received_at < oldestReceivedAt) {
			oldestReceivedAt = lot.received_at;
		}
		const expiry = lot.lot?.expiry;
		const expiryMs = expiry ? Date.parse(expiry) : NaN;
		if (Number.isNaN(expiryMs)) continue;
		if (expiryMs < earliestExpiryMs) {
			earliestExpiryMs = expiryMs;
			earliestExpiry = expiry ?? null;
		}
		if (expiryMs <= now) expiredQty = addQty(expiredQty, lot.qty);
	}

	let expiryState: StockExpiryState = 'none';
	if (earliestExpiry) {
		if (earliestExpiryMs <= now) expiryState = 'expired';
		else if (earliestExpiryMs - now <= expiringWithinDays * DAY_MS) expiryState = 'expiring';
		else expiryState = 'ok';
	}

	return {
		earliestExpiry,
		expiryState,
		lotCount: remaining.length,
		storageKeys: [...storageKeys],
		expiredQty,
		oldestReceivedAt
	};
}

/** Group lot balances by item id. */
export function groupLotsByItem(lots: readonly StockLotBalance[]): Map<string, StockLotBalance[]> {
	const byItem = new Map<string, StockLotBalance[]>();
	for (const lot of lots) {
		const list = byItem.get(lot.item_id);
		if (list) list.push(lot);
		else byItem.set(lot.item_id, [lot]);
	}
	return byItem;
}

/** The consumption fields an item or a shelter override may carry. */
export interface ReorderPolicySource {
	reorder_level?: number | null;
	consumption_rate?: string | null;
	target_reserve_days?: number | null;
	timeframe?: string | null;
}

/**
 * The reorder threshold for an item at the current occupancy, in base units.
 * Priority: override rate × days → override fixed level → item rate × days →
 * item fixed level. `null` = no threshold configured.
 */
export function resolveReorderThreshold(
	occupancy: number,
	item: ReorderPolicySource,
	override?: ReorderPolicySource | null
): string | null {
	if (override) {
		if (override.consumption_rate && override.target_reserve_days) {
			const level = calculateReorderLevel(occupancy, {
				consumption_rate: override.consumption_rate,
				target_reserve_days: override.target_reserve_days,
				timeframe: item.timeframe || 'daily'
			});
			if (level !== null) return level;
		} else if (override.reorder_level !== null && override.reorder_level !== undefined) {
			return String(override.reorder_level);
		}
	}
	const calculated = calculateReorderLevel(occupancy, item);
	if (calculated !== null) return calculated;
	if (item.reorder_level !== null && item.reorder_level !== undefined) {
		return String(item.reorder_level);
	}
	return null;
}

/**
 * Daily usage in base units (`occupancy × rate`, ÷7 for a weekly rate).
 * `null` when no consumption rate is configured — a fixed reorder level alone
 * says nothing about how fast stock is used.
 */
export function dailyConsumption(
	occupancy: number,
	item: ReorderPolicySource,
	override?: ReorderPolicySource | null
): string | null {
	const rate = override?.consumption_rate || item.consumption_rate;
	if (!rate || occupancy <= 0) return null;
	try {
		let daily = new Decimal(rate).mul(occupancy);
		if (item.timeframe === 'weekly') daily = daily.div(7);
		return daily.gt(0) ? daily.toString() : null;
	} catch {
		return null;
	}
}

/** How many days the on-hand stock lasts at the daily usage; `null` = unknown. */
export function daysOfCover(onHand: string, daily: string | null): number | null {
	if (!daily) return null;
	try {
		const perDay = new Decimal(daily);
		if (perDay.lte(0)) return null;
		const days = Decimal.max(new Decimal(onHand), 0).div(perDay);
		return days.toDecimalPlaces(1, Decimal.ROUND_DOWN).toNumber();
	} catch {
		return null;
	}
}

/** Quantity status against the reorder threshold. */
export function deriveStockQtyStatus(onHand: string, threshold: string | null): StockQtyStatus {
	if (qtyLte(onHand, 0)) return 'empty';
	if (threshold !== null && qtyLte(onHand, threshold)) return 'low';
	return 'normal';
}

/**
 * Sort rank — lower needs attention first:
 * expired → empty → low → expiring soon → normal.
 */
export function stockUrgencyRank(status: StockQtyStatus, expiry: StockExpiryState): number {
	if (expiry === 'expired') return 0;
	if (status === 'empty') return 1;
	if (status === 'low') return 2;
	if (expiry === 'expiring') return 3;
	return 4;
}

/** Item ids that have at least one ledger row — "ever stocked" at this shelter. */
export function everStockedItemIds(ledger: readonly Pick<StockLedger, 'item_id'>[]): Set<string> {
	return new Set(ledger.map((e) => e.item_id));
}
