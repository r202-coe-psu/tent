import Decimal from 'decimal.js';
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
 * คำนวณอัตราความต้องการสินค้ารายวัน (Item Daily Demand)
 * Formula: (Total Group Demand * (share_percent / 100)) / conversion_factor
 */
export function calculateItemDailyDemand(
	groupDailyDemand: number,
	sharePercent: number, // 0 - 100
	conversionFactor: number // > 0
): number {
	if (groupDailyDemand <= 0 || conversionFactor <= 0 || sharePercent <= 0) return 0;
	const share = new Decimal(sharePercent).div(100);
	return new Decimal(groupDailyDemand).mul(share).div(conversionFactor).toNumber();
}

/**
 * คำนวณ DoC, Reorder Point, Shortage Qty และประเมินสถานะเตือนภัย 5 ระดับ
 * ป้องกัน Infinity / NaN ด้วย Graceful Fallback (Invariant 4)
 */
export function calculateReplenishmentAnalysis(
	currentStock: number,
	itemDailyDemand: number,
	policy: ReplenishmentPolicy | null | undefined
): ReplenishmentAnalysisResult {
	if (!policy || itemDailyDemand <= 0) {
		return {
			itemDailyDemand: Math.max(0, itemDailyDemand),
			standardReorderDays: 0,
			reorderLevel: 0,
			docDays: null,
			shortageQty: 0,
			status: 'UNCONFIGURED'
		};
	}

	const stock = new Decimal(Math.max(0, currentStock));
	const demand = new Decimal(itemDailyDemand);
	const reorderDays = new Decimal(calculateStandardReorderDays(policy));

	const reorderLevel = demand.mul(reorderDays).toNumber();
	const docDays = demand.gt(0) ? stock.div(demand).toNumber() : null;
	const shortageQty = Decimal.max(0, demand.mul(reorderDays).minus(stock)).toNumber();

	let status: DocAlertStatus;
	if (docDays === null) {
		status = 'UNCONFIGURED';
	} else if (docDays <= policy.lead_time_days || docDays <= policy.min_doc_days) {
		status = 'CRITICAL';
	} else if (docDays <= reorderDays.toNumber()) {
		status = 'WARNING_REORDER';
	} else if (policy.max_doc_days > 0 && docDays > policy.max_doc_days) {
		status = 'OVERSTOCK';
	} else {
		status = 'ADEQUATE';
	}

	return {
		itemDailyDemand,
		standardReorderDays: reorderDays.toNumber(),
		reorderLevel,
		docDays,
		shortageQty,
		status
	};
}
