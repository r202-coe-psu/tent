import { formatThaiShortDate } from '$lib/utils/date';
import { qtyGt } from '$lib/utils/qty';
import { formatLotClockLine } from '../../domain/lot-age';
import { lotStorageName, type StoragePointRef } from '../../domain/lot-storage';
import { sortStockLotsByConsumptionOrder, type StockLotBalance } from '../../domain/operations';

/** One remaining lot as the item detail panel renders it. */
export interface LotRow {
	lotRef: string;
	qty: string;
	unit: string;
	storageName: string | null;
	/** Buddhist-era short date, or null when the lot has no expiry. */
	expiry: string | null;
	isExpired: boolean;
	/** "ในคลัง 3 วัน · หมดอายุใน 5 วัน" */
	clockLine: string;
	/** The lot a direct distribute would draw from first. */
	isNext: boolean;
}

/**
 * Remaining lots in current consumption order. `isNext` marks the first lot that
 * has not expired — an expired lot must be adjusted out, not drawn from (CR-143 FR-A4).
 */
export function buildLotRows(
	lots: readonly StockLotBalance[],
	points: readonly StoragePointRef[] = [],
	now: number = Date.now()
): LotRow[] {
	const ordered = sortStockLotsByConsumptionOrder(lots.filter((l) => qtyGt(l.qty, 0)));
	let nextAssigned = false;
	return ordered.map((lot) => {
		const expiry = lot.lot?.expiry ?? null;
		const expiryMs = expiry ? Date.parse(expiry) : NaN;
		const isExpired = !Number.isNaN(expiryMs) && expiryMs <= now;
		const isNext = !isExpired && !nextAssigned;
		if (isNext) nextAssigned = true;
		return {
			lotRef: lot.lot_ref,
			qty: lot.qty,
			unit: lot.unit,
			storageName: lotStorageName(lot.lot, points),
			expiry: expiry ? formatThaiShortDate(expiry) : null,
			isExpired,
			clockLine: formatLotClockLine(lot, now),
			isNext
		};
	});
}
