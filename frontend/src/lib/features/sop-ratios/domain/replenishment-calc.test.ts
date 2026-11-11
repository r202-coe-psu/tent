import { describe, it, expect } from 'vitest';
import {
	calculateStandardReorderDays,
	calculateItemDailyDemand,
	calculateItemDailyDemandDecimal,
	calculateReplenishmentAnalysis,
	type DocAlertStatus
} from './replenishment-calc';
import { DEFAULT_REPLENISHMENT_POLICIES } from './replenishment-policy.fixture';
import type { ReplenishmentPolicy } from './replenishment-policy';
import type { QtyValue } from '$lib/utils/qty';

/** Policy with explicit values so expected numbers below never depend on fixtures. */
function makePolicy(over: Partial<ReplenishmentPolicy> = {}): ReplenishmentPolicy {
	return {
		_id: 'replenishment_policy:REQUIREMENT_GROUP:FOOD_ENERGY',
		type: 'replenishment_policy',
		schema_v: 1,
		scope_type: 'REQUIREMENT_GROUP',
		target_id: 'FOOD_ENERGY',
		lead_time_days: 3,
		review_period_days: 4,
		safety_days: 3,
		min_doc_days: 3,
		max_doc_days: 45,
		source: 'SPHERE_BASELINE',
		created_at: '2026-07-16T00:00:00.000Z',
		updated_at: '2026-07-16T00:00:00.000Z',
		created_by: 'system',
		...over
	};
}

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

describe('Replenishment decimal precision (#936)', () => {
	// Base policy B: lead 3, review 4, safety 3 (reorder 10), min_doc 3, max_doc 45
	const B = makePolicy();
	const B_MIN0 = makePolicy({ min_doc_days: 0 });
	const LEAD2 = makePolicy({ lead_time_days: 2, safety_days: 4, min_doc_days: 5 }); // reorder 10
	const MAX0 = makePolicy({ max_doc_days: 0 });

	interface StatusRow {
		name: string;
		stock: QtyValue;
		/** Thunk for new Decimal APIs so this file still collects while they are missing. */
		demand: QtyValue | (() => QtyValue);
		policy: ReplenishmentPolicy;
		status: DocAlertStatus;
		docDays: number;
	}

	describe('status boundary matrix', () => {
		const rows: StatusRow[] = [
			{
				name: 'bug #936: Decimal demand 2 x 100% / 3 lands exactly on lead time',
				stock: '2',
				demand: () => calculateItemDailyDemandDecimal(2, 100, 3),
				policy: B_MIN0,
				status: 'CRITICAL',
				docDays: 3
			},
			{
				name: 'bug #936: number demand from calculateItemDailyDemand',
				stock: 2,
				demand: calculateItemDailyDemand(2, 100, 3),
				policy: B_MIN0,
				status: 'CRITICAL',
				docDays: 3
			},
			{
				name: 'just above lead time',
				stock: '2.0001',
				demand: () => calculateItemDailyDemandDecimal(2, 100, 3),
				policy: B_MIN0,
				status: 'WARNING_REORDER',
				docDays: 3.0002
			},
			{
				name: 'DoC equal to lead time (0.7/day)',
				stock: '2.1',
				demand: '0.7',
				policy: B,
				status: 'CRITICAL',
				docDays: 3
			},
			{
				name: 'DoC lead time + 0.0001',
				stock: '2.1001',
				demand: '0.7',
				policy: B,
				status: 'WARNING_REORDER',
				docDays: 3.0001
			},
			{
				name: 'DoC equal to reorder days',
				stock: '7',
				demand: '0.7',
				policy: B,
				status: 'WARNING_REORDER',
				docDays: 10
			},
			{
				name: 'DoC reorder days + 0.0001',
				stock: '7.0001',
				demand: '0.7',
				policy: B,
				status: 'ADEQUATE',
				docDays: 10.0001
			},
			{
				name: 'DoC equal to max_doc_days',
				stock: '31.5',
				demand: '0.7',
				policy: B,
				status: 'ADEQUATE',
				docDays: 45
			},
			{
				name: 'DoC max_doc_days + 0.0001',
				stock: '31.5001',
				demand: '0.7',
				policy: B,
				status: 'OVERSTOCK',
				docDays: 45.0001
			},
			{
				name: '5th decimal rounds down (3.00004 -> 3)',
				stock: '3.00004',
				demand: '1',
				policy: B,
				status: 'CRITICAL',
				docDays: 3
			},
			{
				name: '5th decimal rounds half up (3.00005 -> 3.0001)',
				stock: '3.00005',
				demand: '1',
				policy: B,
				status: 'WARNING_REORDER',
				docDays: 3.0001
			},
			{
				name: 'DoC equal to min_doc_days when min_doc > lead time',
				stock: '5',
				demand: '1',
				policy: LEAD2,
				status: 'CRITICAL',
				docDays: 5
			},
			{
				name: 'DoC min_doc_days + 0.0001',
				stock: '5.0001',
				demand: '1',
				policy: LEAD2,
				status: 'WARNING_REORDER',
				docDays: 5.0001
			},
			{
				name: 'max_doc_days 0 never reports OVERSTOCK',
				stock: '1000',
				demand: '1',
				policy: MAX0,
				status: 'ADEQUATE',
				docDays: 1000
			},
			{
				name: 'zero stock',
				stock: '0',
				demand: '1',
				policy: B,
				status: 'CRITICAL',
				docDays: 0
			},
			{
				name: 'negative stock is clamped to zero',
				stock: '-5',
				demand: '1',
				policy: B,
				status: 'CRITICAL',
				docDays: 0
			},
			{
				name: '0.3 demand is float-safe',
				stock: '0.9',
				demand: '0.3',
				policy: B,
				status: 'CRITICAL',
				docDays: 3
			},
			{
				name: 'tiny demand keeps the existing rule (OVERSTOCK)',
				stock: '1',
				demand: '0.00001',
				policy: B,
				status: 'OVERSTOCK',
				docDays: 100000
			}
		];

		it.each(rows)('$name', ({ stock, demand, policy, status, docDays }) => {
			const resolvedDemand = typeof demand === 'function' ? demand() : demand;
			const result = calculateReplenishmentAnalysis(stock, resolvedDemand, policy);
			expect(result.status).toBe(status);
			expect(result.docDays).toBe(docDays);
		});
	});

	describe('unconfigured inputs', () => {
		it.each([
			{ name: 'no policy', stock: '10', demand: '5', policy: null },
			{ name: 'demand 0', stock: '10', demand: '0', policy: B },
			{ name: 'demand -1', stock: '10', demand: '-1', policy: B }
		])('$name is UNCONFIGURED with finite numbers only', ({ stock, demand, policy }) => {
			const result = calculateReplenishmentAnalysis(stock, demand, policy);
			expect(result.status).toBe('UNCONFIGURED');
			expect(result.docDays).toBeNull();
			expect(Number.isFinite(result.itemDailyDemand)).toBe(true);
			expect(Number.isFinite(result.reorderLevel)).toBe(true);
			expect(Number.isFinite(result.shortageQty)).toBe(true);
		});
	});

	it('gives identical results for legacy number and string inputs', () => {
		expect(calculateReplenishmentAnalysis(2.1, 0.7, B)).toEqual(
			calculateReplenishmentAnalysis('2.1', '0.7', B)
		);
	});

	it('computes reorder level and shortage without float drift', () => {
		const atLead = calculateReplenishmentAnalysis('2.1', '0.7', B);
		expect(atLead.reorderLevel).toBe(7);
		expect(atLead.shortageQty).toBe(4.9);

		const justAbove = calculateReplenishmentAnalysis('2.1001', '0.7', B);
		expect(justAbove.shortageQty).toBe(4.8999);
	});

	it('clamps negative stock to zero shortage base (shortage = full reorder level)', () => {
		const result = calculateReplenishmentAnalysis('-5', '1', B);
		expect(result.shortageQty).toBe(10);
	});

	it('computes reorder level and shortage for 0.3 demand float-safely', () => {
		const result = calculateReplenishmentAnalysis('0.9', '0.3', B);
		expect(result.reorderLevel).toBe(3);
		expect(result.shortageQty).toBe(2.1);
	});

	describe('calculateItemDailyDemandDecimal', () => {
		it.each([
			{ name: 'string inputs with 2 decimals', args: ['2100', '33.33', '6.3'], expected: '111.1' },
			{
				name: 'full precision to 20 significant digits',
				args: ['2100', '33.34', '17'],
				expected: '41.184705882352941176'
			},
			{ name: 'tiny conversion factor', args: [1, 100, '0.0001'], expected: '10000' },
			{ name: 'share 0 gives 0', args: ['2100', '0', '350'], expected: '0' },
			{ name: 'share 100 is identity', args: ['2100', '100', '350'], expected: '6' },
			{ name: 'conversion factor 0 gives 0', args: ['2100', '50', '0'], expected: '0' },
			{ name: 'group demand 0 gives 0', args: [0, 50, 350], expected: '0' },
			{
				name: 'repeating result keeps 20 significant digits',
				args: [2, 100, 3],
				expected: '0.66666666666666666667'
			}
		])('$name', ({ args, expected }) => {
			const [group, share, cf] = args as [QtyValue, QtyValue, QtyValue];
			expect(calculateItemDailyDemandDecimal(group, share, cf).toString()).toBe(expected);
		});
	});

	it('accepts string inputs in calculateItemDailyDemand and returns a number', () => {
		expect(calculateItemDailyDemand('2100', '50', '350')).toBe(3);
	});
});
