import Decimal from 'decimal.js';
import { persistQty } from '$lib/utils/qty';
import type { ItemMaster } from '$lib/features/catalog';

export function calculateReorderLevel(
	occupancy: number,
	item: Pick<ItemMaster, 'consumption_rate' | 'target_reserve_days' | 'timeframe'>
): string | null {
	if (
		!item.consumption_rate ||
		item.target_reserve_days === undefined ||
		item.target_reserve_days === null
	) {
		return null;
	}
	try {
		const rate = new Decimal(item.consumption_rate);
		const days = new Decimal(item.target_reserve_days);
		const people = new Decimal(occupancy);
		let result = people.mul(rate).mul(days);
		if (item.timeframe === 'weekly') {
			result = result.div(7);
		}

		return persistQty(result);
	} catch (error) {
		console.error(`คำนวณเกณฑ์เตือนภัยสินค้าล้มเหลว:`, error);
		return null;
	}
}
