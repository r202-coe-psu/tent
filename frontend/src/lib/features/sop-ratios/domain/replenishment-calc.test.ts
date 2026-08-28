import { describe, it, expect } from 'vitest';
import {
	calculateStandardReorderDays,
	calculateItemDailyDemand,
	calculateReplenishmentAnalysis
} from './replenishment-calc';
import { DEFAULT_REPLENISHMENT_POLICIES } from './replenishment-policy.fixture';

describe('Replenishment Calculation Engine', () => {
	const defaultPolicy = DEFAULT_REPLENISHMENT_POLICIES[0]; // FOOD_ENERGY: lead: 3, review: 4, safety: 3, min: 3, max: 45 -> reorderDays: 10

	it('calculates Standard Reorder Days correctly', () => {
		const days = calculateStandardReorderDays(defaultPolicy);
		expect(days).toBe(10); // 3 + 4 + 3 = 10

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
		// Policy: lead: 3, min: 3, reorder: 10, max: 45
		// Daily demand = 5
		// Stock = 5 -> DoC = 1 day (<= 3)
		const result = calculateReplenishmentAnalysis(5, 5, defaultPolicy);
		expect(result.docDays).toBe(1);
		expect(result.status).toBe('CRITICAL');
		expect(result.reorderLevel).toBe(50); // 10 * 5
		expect(result.shortageQty).toBe(45); // 50 - 5
	});

	it('evaluates WARNING_REORDER status when DoC is between Lead Time and Reorder Days', () => {
		// Policy: lead: 3, min: 3, reorder: 10, max: 45
		// Daily demand = 5
		// Stock = 25 -> DoC = 5 days (> 3 and <= 10)
		const result = calculateReplenishmentAnalysis(25, 5, defaultPolicy);
		expect(result.docDays).toBe(5);
		expect(result.status).toBe('WARNING_REORDER');
		expect(result.shortageQty).toBe(25); // 50 - 25
	});

	it('evaluates ADEQUATE status when DoC is between Reorder Days and Max DoC', () => {
		// Policy: lead: 3, min: 3, reorder: 10, max: 45
		// Daily demand = 5
		// Stock = 100 -> DoC = 20 days (> 10 and <= 45)
		const result = calculateReplenishmentAnalysis(100, 5, defaultPolicy);
		expect(result.docDays).toBe(20);
		expect(result.status).toBe('ADEQUATE');
		expect(result.shortageQty).toBe(0);
	});

	it('evaluates OVERSTOCK status when DoC > Max DoC', () => {
		// Policy: lead: 3, min: 3, reorder: 10, max: 45
		// Daily demand = 5
		// Stock = 300 -> DoC = 60 days (> 45)
		const result = calculateReplenishmentAnalysis(300, 5, defaultPolicy);
		expect(result.docDays).toBe(60);
		expect(result.status).toBe('OVERSTOCK');
		expect(result.shortageQty).toBe(0);
	});
});
