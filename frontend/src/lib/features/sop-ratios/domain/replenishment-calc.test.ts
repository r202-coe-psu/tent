import { describe, it, expect } from 'vitest';
import {
	calculateStandardReorderDays,
	calculateItemDailyDemand,
	calculateReplenishmentAnalysis
} from './replenishment-calc';
import { DEFAULT_REPLENISHMENT_POLICIES } from './replenishment-policy.fixture';

describe('Replenishment Calculation Engine', () => {
	const defaultPolicy = DEFAULT_REPLENISHMENT_POLICIES[0]; // lead: 2, review: 3, safety: 2, min: 2, max: 30 -> reorderDays: 7

	it('calculates Standard Reorder Days correctly', () => {
		const days = calculateStandardReorderDays(defaultPolicy);
		expect(days).toBe(7); // 2 + 3 + 2 = 7

		expect(calculateStandardReorderDays(null)).toBe(0);
	});

	it('calculates Item Daily Demand correctly with conversion factor & share %', () => {
		// Group Daily Demand = 2100 kcal
		// Share % = 50%
		// Conversion factor = 350 (e.g. kcal per bag)
		// Item Daily Demand = (2100 * 0.5) / 350 = 3 bags/day
		const itemDemand = calculateItemDailyDemand(2100, 50, 350);
		expect(itemDemand).toBe(3);

		// Zero or invalid cases
		expect(calculateItemDailyDemand(0, 50, 350)).toBe(0);
		expect(calculateItemDailyDemand(2100, 0, 350)).toBe(0);
		expect(calculateItemDailyDemand(2100, 50, 0)).toBe(0);
	});

	it('handles zero demand gracefully with UNCONFIGURED status (Invariant 4)', () => {
		const result = calculateReplenishmentAnalysis(100, 0, defaultPolicy);
		expect(result.docDays).toBeNull();
		expect(result.status).toBe('UNCONFIGURED');
		expect(result.standardReorderDays).toBe(0);
		expect(result.shortageQty).toBe(0);
	});

	it('handles missing policy gracefully with UNCONFIGURED status', () => {
		const result = calculateReplenishmentAnalysis(100, 10, null);
		expect(result.docDays).toBeNull();
		expect(result.status).toBe('UNCONFIGURED');
	});

	it('evaluates CRITICAL status when DoC <= Lead Time or DoC <= min_doc_days', () => {
		// Policy: lead: 2, min: 2, reorder: 7, max: 30
		// Daily demand = 5
		// Stock = 5 -> DoC = 1 day (<= 2)
		const result = calculateReplenishmentAnalysis(5, 5, defaultPolicy);
		expect(result.docDays).toBe(1);
		expect(result.status).toBe('CRITICAL');
		expect(result.reorderLevel).toBe(35); // 7 * 5
		expect(result.shortageQty).toBe(30); // 35 - 5
	});

	it('evaluates WARNING_REORDER status when DoC is between Lead Time and Reorder Days', () => {
		// Policy: lead: 2, min: 2, reorder: 7, max: 30
		// Daily demand = 5
		// Stock = 20 -> DoC = 4 days (> 2 and <= 7)
		const result = calculateReplenishmentAnalysis(20, 5, defaultPolicy);
		expect(result.docDays).toBe(4);
		expect(result.status).toBe('WARNING_REORDER');
		expect(result.shortageQty).toBe(15); // 35 - 20
	});

	it('evaluates ADEQUATE status when DoC is between Reorder Days and Max DoC', () => {
		// Policy: lead: 2, min: 2, reorder: 7, max: 30
		// Daily demand = 5
		// Stock = 60 -> DoC = 12 days (> 7 and <= 30)
		const result = calculateReplenishmentAnalysis(60, 5, defaultPolicy);
		expect(result.docDays).toBe(12);
		expect(result.status).toBe('ADEQUATE');
		expect(result.shortageQty).toBe(0);
	});

	it('evaluates OVERSTOCK status when DoC > Max DoC', () => {
		// Policy: lead: 2, min: 2, reorder: 7, max: 30
		// Daily demand = 5
		// Stock = 200 -> DoC = 40 days (> 30)
		const result = calculateReplenishmentAnalysis(200, 5, defaultPolicy);
		expect(result.docDays).toBe(40);
		expect(result.status).toBe('OVERSTOCK');
		expect(result.shortageQty).toBe(0);
	});
});
