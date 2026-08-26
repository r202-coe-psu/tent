import Decimal from 'decimal.js';
import type { FoodSphereStandard, TargetSegment } from './food-sphere';

export type HeadcountBySegment = Record<TargetSegment, number>;

/**
 * คำนวณความต้องการกลุ่มสารอาหารรวมต่อวัน (Total Daily Demand) พร้อม Segment Fallback (Invariant 8)
 *
 * Total Daily Demand = sum( Headcount_segment * daily_demand_effective(segment, group) )
 * หากไม่มี food_sphere_standard สำหรับ (target_segment, req_group_id) คู่นั้น ระบบจะ fallback ไปใช้ target_segment = 'ALL'
 */
export function calculateTotalDailyDemand(
	reqGroupId: string,
	headcounts: Partial<HeadcountBySegment>,
	standards: FoodSphereStandard[]
): number {
	let total = new Decimal(0);
	const groupStandards = standards.filter((s) => s.req_group_id === reqGroupId);
	const fallbackAll = groupStandards.find((s) => s.target_segment === 'ALL');

	for (const [segment, count] of Object.entries(headcounts) as [
		TargetSegment,
		number | undefined
	][]) {
		if (count === undefined || count === null || count <= 0) continue;
		const std = groupStandards.find((s) => s.target_segment === segment) ?? fallbackAll;
		if (std && std.daily_demand > 0) {
			total = total.plus(new Decimal(count).mul(std.daily_demand));
		}
	}

	return total.toNumber();
}
