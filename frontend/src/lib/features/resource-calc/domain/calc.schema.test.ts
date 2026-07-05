import { describe, it, expect } from 'vitest';
import {
	resourceInputSchema,
	calcInputSchema,
	resourceCalcResultSchema,
	calcOutputSchema,
	dailyCalcDocSchema
} from './calc.schema';
import { calculateResources, FORMULA_V } from './calc.formula';
// Barrel-consumable check (review suggestion): prove the new schemas are actually
// re-exported through the public feature barrel, not just the deep domain path.
import * as barrel from '$lib/features/resource-calc';

const AS_OF = '2026-07-03T00:00:00.000Z';

const validResult = {
	ordinal: 0,
	key: 'water_l_per_person_day',
	kind: 'multiply' as const,
	input_valid: true,
	ratio: 15,
	need: 1500,
	have: 500,
	gap: 1000,
	status: 'gap' as const,
	data_status: 'complete' as const,
	as_of: AS_OF
};

const validDoc = {
	formula_v: FORMULA_V,
	sop_profile_version: 1,
	ratio_snapshot: { water_l_per_person_day: 15 },
	occupancy_snapshot: 100,
	as_of: AS_OF,
	stock_snapshot: { water_l_per_person_day: 500 },
	results: [validResult]
};

describe('calc.schema — valid parse', () => {
	it('accepts a valid CalcInput', () => {
		const input = {
			occupancy: 120,
			as_of: AS_OF,
			resources: [{ key: 'water_l_per_person_day', kind: 'multiply', ratio: 15, have: 1000 }]
		};
		expect(calcInputSchema.safeParse(input).success).toBe(true);
	});

	it('accepts ratio/have = null (absent / not synced)', () => {
		expect(
			resourceInputSchema.safeParse({ key: 'x', kind: 'divide', ratio: null, have: null }).success
		).toBe(true);
	});

	it('accepts a valid CalcOutput', () => {
		expect(
			calcOutputSchema.safeParse({ formula_v: FORMULA_V, results: [validResult] }).success
		).toBe(true);
	});

	it('accepts a valid DailyCalcDoc with all 6 snapshot fields', () => {
		expect(dailyCalcDocSchema.safeParse(validDoc).success).toBe(true);
	});

	it('ratio_snapshot / stock_snapshot keys are GENERIC (not constrained to SOP_RATIO_KEYS)', () => {
		// The engine is domain-agnostic (ResourceKey = string) — resources span more than the
		// 20 SOP keys (food ingredients, stock items, facilities). A non-SOP key must be accepted.
		const doc = {
			...validDoc,
			ratio_snapshot: { some_stock_item_sku: 2.5, facility_showers: 50 },
			stock_snapshot: { some_stock_item_sku: 10, facility_showers: null }
		};
		expect(dailyCalcDocSchema.safeParse(doc).success).toBe(true);
	});
});

describe('calc.schema — rejects invalid input (assert the offending field, not just "threw")', () => {
	const expectFieldError = (result: { success: boolean; error?: unknown }, field: string) => {
		expect(result.success).toBe(false);
		const issues = (result as { error: { issues: { path: (string | number)[] }[] } }).error.issues;
		expect(issues.some((i) => i.path.includes(field))).toBe(true);
	};

	it('CalcInput.as_of not datetime → error on as_of', () => {
		expectFieldError(
			calcInputSchema.safeParse({ occupancy: 10, as_of: 'not-a-date', resources: [] }),
			'as_of'
		);
	});

	it('CalcInput.occupancy negative → error on occupancy', () => {
		expectFieldError(
			calcInputSchema.safeParse({ occupancy: -1, as_of: AS_OF, resources: [] }),
			'occupancy'
		);
	});

	it('ResourceInput.ratio = 0 → error on ratio (caller invariant ratio > 0 when present)', () => {
		expectFieldError(
			resourceInputSchema.safeParse({ key: 'x', kind: 'multiply', ratio: 0, have: null }),
			'ratio'
		);
	});

	it('ResourceInput.have negative → error on have', () => {
		expectFieldError(
			resourceInputSchema.safeParse({ key: 'x', kind: 'multiply', ratio: 5, have: -3 }),
			'have'
		);
	});

	it('ResourceInput.kind out of enum → error on kind', () => {
		expectFieldError(
			resourceInputSchema.safeParse({ key: 'x', kind: 'bogus', ratio: 5, have: 1 }),
			'kind'
		);
	});

	it('ResourceCalcResult.status out of enum → error on status', () => {
		expectFieldError(
			resourceCalcResultSchema.safeParse({ ...validResult, status: 'nope' }),
			'status'
		);
	});

	it('DailyCalcDoc.sop_profile_version <= 0 → error on sop_profile_version', () => {
		expectFieldError(
			dailyCalcDocSchema.safeParse({ ...validDoc, sop_profile_version: 0 }),
			'sop_profile_version'
		);
	});

	it('DailyCalcDoc missing ratio_snapshot → error on ratio_snapshot', () => {
		const withoutRatio: Partial<typeof validDoc> = { ...validDoc };
		delete withoutRatio.ratio_snapshot;
		expectFieldError(dailyCalcDocSchema.safeParse(withoutRatio), 'ratio_snapshot');
	});

	// Finiteness contract: every numeric field rejects NaN and ±Infinity (Zod's z.number() does
	// this by default; the schema also states `.finite()` explicitly). These tests lock the
	// contract in so a future swap to a permissive number type is caught.
	it('ResourceInput.ratio = Infinity → error on ratio (finiteness gate)', () => {
		expectFieldError(
			resourceInputSchema.safeParse({ key: 'x', kind: 'multiply', ratio: Infinity, have: 1 }),
			'ratio'
		);
	});

	it('ResourceInput.ratio = -Infinity → error on ratio', () => {
		expectFieldError(
			resourceInputSchema.safeParse({ key: 'x', kind: 'multiply', ratio: -Infinity, have: 1 }),
			'ratio'
		);
	});

	it('CalcInput.occupancy = Infinity → error on occupancy', () => {
		expectFieldError(
			calcInputSchema.safeParse({ occupancy: Infinity, as_of: AS_OF, resources: [] }),
			'occupancy'
		);
	});

	it('ResourceCalcResult.need = Infinity → error on need (formula guarantees finite)', () => {
		expectFieldError(
			resourceCalcResultSchema.safeParse({ ...validResult, need: Infinity }),
			'need'
		);
	});

	it('ResourceCalcResult.gap = -Infinity → error on gap', () => {
		expectFieldError(resourceCalcResultSchema.safeParse({ ...validResult, gap: -Infinity }), 'gap');
	});

	// .strict(): unknown/extra keys are rejected (this is what makes round-trip a drift detector).
	it('ResourceCalcResult with an unknown extra key → rejected (strict)', () => {
		expect(resourceCalcResultSchema.safeParse({ ...validResult, foo: 123 }).success).toBe(false);
	});
});

describe('calc.schema — round-trip with the real formula (no drift)', () => {
	it('calculateResources output parses through calcOutputSchema + each row', () => {
		const results = calculateResources({
			occupancy: 120,
			as_of: AS_OF,
			resources: [
				{ key: 'water_l_per_person_day', kind: 'multiply', ratio: 15, have: 1000 },
				{ key: 'people_per_volunteer', kind: 'divide', ratio: 50, have: null },
				{ key: 'max_queue_minutes', kind: 'threshold', ratio: 30, have: 25 }
			]
		});
		expect(calcOutputSchema.safeParse({ formula_v: FORMULA_V, results }).success).toBe(true);
		for (const row of results) {
			expect(resourceCalcResultSchema.safeParse(row).success).toBe(true);
		}
	});
});

describe('calc.schema — snapshot lock (frozen values survive a later ratio change)', () => {
	it('DailyCalcDoc captures the day-1 values, not a live reference', () => {
		// Day 1: ratio 15, occupancy 100 → need 1500. Freeze it into a doc.
		const day1 = calculateResources({
			occupancy: 100,
			as_of: '2026-07-01T00:00:00.000Z',
			resources: [{ key: 'water_l_per_person_day', kind: 'multiply', ratio: 15, have: 500 }]
		});
		const doc = dailyCalcDocSchema.parse({
			formula_v: FORMULA_V,
			sop_profile_version: 1,
			ratio_snapshot: { water_l_per_person_day: 15 },
			occupancy_snapshot: 100,
			as_of: '2026-07-01T00:00:00.000Z',
			stock_snapshot: { water_l_per_person_day: 500 },
			results: day1
		});

		// Day 15: the live master ratio is raised to 20 — but the frozen doc is unaffected.
		// (Domain layer has no live profile; the point is the doc holds literal snapshot values.)
		expect(doc.ratio_snapshot.water_l_per_person_day).toBe(15);
		expect(doc.occupancy_snapshot).toBe(100);
		expect(doc.results[0].need).toBe(1500); // 100 × 15, NOT 100 × 20
		expect(doc.sop_profile_version).toBe(1);
		expect(doc.formula_v).toBe(FORMULA_V); // pinned to whatever formula produced it
	});
});

describe('calc.schema — barrel exports are consumable', () => {
	it('re-exports the new schemas through $lib/features/resource-calc', () => {
		expect(barrel.calcInputSchema).toBeDefined();
		expect(barrel.calcOutputSchema).toBeDefined();
		expect(barrel.dailyCalcDocSchema).toBeDefined();
		expect(barrel.DAILY_CALC_SCHEMA_VERSION).toBe(1);
		// and the pre-existing T-31.1 exports remain (additive, non-breaking)
		expect(barrel.calculateResources).toBeDefined();
		expect(barrel.FORMULA_V).toBe(FORMULA_V);
	});
});
