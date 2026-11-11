import Decimal from 'decimal.js';
import { parseQty, qtyGt, qtyLte, roundQtyNumber, type QtyValue } from '$lib/utils/qty';
import type { ReplenishmentPolicy } from './replenishment-policy';

export type DocAlertStatus =
	'UNCONFIGURED' | 'CRITICAL' | 'WARNING_REORDER' | 'ADEQUATE' | 'OVERSTOCK';

export interface ReplenishmentAnalysisResult {
	itemDailyDemand: number;
	standardReorderDays: number;
	reorderLevel: number;
	docDays: number | null;
	shortageQty: number;
	status: DocAlertStatus;
}

/**
 * คำนวณจำนวนวันสั่งเติมมาตรฐาน (Standard Reorder Days)
 * Formula: Lead Time + Review Period + Safety Days
 */
export function calculateStandardReorderDays(
	policy: ReplenishmentPolicy | null | undefined
): number {
	if (!policy) return 0;
	return policy.lead_time_days + policy.review_period_days + policy.safety_days;
}

/**
 * คำนวณอัตราความต้องการสินค้ารายวัน (Item Daily Demand) — full precision
 * Formula: (Total Group Demand * (share_percent / 100)) / conversion_factor
 */
export function calculateItemDailyDemandDecimal(
	groupDailyDemand: QtyValue,
	sharePercent: QtyValue, // 0 - 100
	conversionFactor: QtyValue // > 0
): Decimal {
	const group = parseQty(groupDailyDemand);
	const share = parseQty(sharePercent);
	const cf = parseQty(conversionFactor);
	if (group.lte(0) || cf.lte(0) || share.lte(0)) return new Decimal(0);
	return group.mul(share.div(100)).div(cf);
}

/** Number form of {@link calculateItemDailyDemandDecimal} (display only). */
export function calculateItemDailyDemand(
	groupDailyDemand: QtyValue,
	sharePercent: QtyValue,
	conversionFactor: QtyValue
): number {
	return calculateItemDailyDemandDecimal(
		groupDailyDemand,
		sharePercent,
		conversionFactor
	).toNumber();
}

/**
 * คำนวณ DoC, Reorder Point, Shortage Qty และประเมินสถานะเตือนภัย 5 ระดับ
 * ป้องกัน Infinity / NaN ด้วย Graceful Fallback (Invariant 4)
 */
export function calculateReplenishmentAnalysis(
	currentStock: QtyValue,
	itemDailyDemand: QtyValue,
	policy: ReplenishmentPolicy | null | undefined
): ReplenishmentAnalysisResult {
	const demand = parseQty(itemDailyDemand);
	if (!policy || demand.lte(0)) {
		return {
			itemDailyDemand: Decimal.max(0, demand).toNumber(),
			standardReorderDays: 0,
			reorderLevel: 0,
			docDays: null,
			shortageQty: 0,
			status: 'UNCONFIGURED'
		};
	}

	const stock = Decimal.max(0, parseQty(currentStock));
	const reorderDays = new Decimal(calculateStandardReorderDays(policy));

	const reorderLevel = demand.mul(reorderDays);
	const docDecimal = stock.div(demand);
	const shortageQty = Decimal.max(0, reorderLevel.minus(stock));

	let status: DocAlertStatus;
	if (qtyLte(docDecimal, policy.lead_time_days) || qtyLte(docDecimal, policy.min_doc_days)) {
		status = 'CRITICAL';
	} else if (qtyLte(docDecimal, reorderDays)) {
		status = 'WARNING_REORDER';
	} else if (policy.max_doc_days > 0 && qtyGt(docDecimal, policy.max_doc_days)) {
		status = 'OVERSTOCK';
	} else {
		status = 'ADEQUATE';
	}

	return {
		itemDailyDemand: demand.toNumber(),
		standardReorderDays: reorderDays.toNumber(),
		reorderLevel: reorderLevel.toNumber(),
		docDays: roundQtyNumber(docDecimal),
		shortageQty: shortageQty.toNumber(),
		status
	};
}
