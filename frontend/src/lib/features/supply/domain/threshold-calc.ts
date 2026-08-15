import Decimal from 'decimal.js';
import { persistQty } from '$lib/utils/qty';

export function calculateReorderLevel(
	occupancy: number,
	item: {
		consumption_rate?: string | null;
		target_reserve_days?: number | null;
		timeframe?: string | null;
	}
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
	} catch {
		return null;
	}
}
