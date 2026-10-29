import { formatThaiShortDate } from '$lib/utils/date';
import { qtyGt } from '$lib/utils/qty';
import { formatLotClockLine } from '../../domain/lot-age';
import { lotStorageName, type StoragePointRef } from '../../domain/lot-storage';
import { isLotExpired, lotPriorityReason, type LotPriorityItem } from '../../domain/lot-priority';
import {
	isNegativeLot,
	sortStockLotsByConsumptionOrder,
	type StockLotBalance
} from '../../domain/operations';

/** One remaining lot as the item detail panel renders it. */
export interface LotRow {
	lotRef: string;
	qty: string;
	unit: string;
	storageName: string | null;
	/** What the lot's storage point can hold, e.g. "อาหารแห้ง, น้ำดื่ม" (#647 AC3). */
	storageTypes: string | null;
	/** Buddhist-era short date, or null when the lot has no expiry. */
	expiry: string | null;
	isExpired: boolean;
	/** "ในคลัง 3 วัน · หมดอายุใน 5 วัน" */
	clockLine: string;
	/** Why the lot sits here in the issue order, e.g. "หมดอายุอีก 3 วัน" (CR-143 FR-A6). */
	reason: string;
	/** The lot a direct distribute would draw from first. */
	isNext: boolean;
	/** Overdrawn lot (#855): listed last with a warning, never issued from. */
	isNegative: boolean;
}

/** Type labels of the configured point a lot sits in; null for a deleted point or no point. */
function storagePointTypes(
	pointId: string | null | undefined,
	points: readonly StoragePointRef[]
): string | null {
	if (!pointId) return null;
	const labels = points.find((p) => p.id === pointId)?.typeLabels;
	return labels?.length ? labels.join(', ') : null;
}

/**
 * Remaining lots in issue-priority order (CR-143 §A). `isNext` marks the first lot
 * that has not expired — an expired lot must be adjusted out, not drawn from (FR-A4).
 * `itemsById` supplies shelf life / storage type; without it a 365-day horizon is assumed.
 */
export function buildLotRows(
	lots: readonly StockLotBalance[],
	points: readonly StoragePointRef[] = [],
	now: number = Date.now(),
	itemsById?: ReadonlyMap<string, LotPriorityItem>
): LotRow[] {
	const ordered = sortStockLotsByConsumptionOrder(
		lots.filter((l) => qtyGt(l.qty, 0)),
		itemsById,
		now
	);
	let nextAssigned = false;
	const negatives = lots.filter(isNegativeLot).map((lot): LotRow => ({
		lotRef: lot.lot_ref,
		qty: lot.qty,
		unit: lot.unit,
		storageName: lotStorageName(lot.lot, points),
		storageTypes: storagePointTypes(lot.lot?.storage_point_id, points),
		expiry: lot.lot?.expiry ? formatThaiShortDate(lot.lot.expiry) : null,
		isExpired: false,
		clockLine: formatLotClockLine(lot, now),
		reason: 'ล็อตติดลบ — ห้ามเบิกจากล็อตนี้ กรุณาแจ้งผู้ดูแลระบบ',
		isNext: false,
		isNegative: true
	}));
	const usable = ordered.map((lot) => {
		const expiry = lot.lot?.expiry ?? null;
		const isExpired = isLotExpired(lot, now, itemsById?.get(lot.item_id));
		const isNext = !isExpired && !nextAssigned;
		if (isNext) nextAssigned = true;
		return {
			lotRef: lot.lot_ref,
			qty: lot.qty,
			unit: lot.unit,
			storageName: lotStorageName(lot.lot, points),
			storageTypes: storagePointTypes(lot.lot?.storage_point_id, points),
			expiry: expiry ? formatThaiShortDate(expiry) : null,
			isExpired,
			clockLine: formatLotClockLine(lot, now),
			reason: lotPriorityReason(lot, itemsById?.get(lot.item_id), now),
			isNext,
			isNegative: false
		};
	});
	return [...usable, ...negatives];
}
