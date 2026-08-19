import { describe, it, expect } from 'vitest';
import { calculateResources, type ResourceInput } from './calc.formula';
import {
	daysOfSupply,
	rowSeverity,
	summarizeStatuses,
	sortBySeverity,
	SEVERITY_RANK
} from './dashboard-view';

const AS_OF = '2026-07-25T00:00:00.000Z';

/**
 * Build one computed row through the REAL engine (keeps `ResourceCalcResult` shape honest).
 * `ratio`/`have` are decimal STRINGS on the input (CR-038); accept numbers here for brevity.
 */
const row = (kind: ResourceInput['kind'], ratio: number | null, have: number | null, occ = 100) =>
	calculateResources({
		occupancy: occ,
		as_of: AS_OF,
		resources: [
			{
				key: 'x',
				kind,
				ratio: ratio == null ? null : String(ratio),
				have: have == null ? null : String(have)
			}
		]
	})[0];

describe('daysOfSupply', () => {
	it('multiply → have / need (per-day requirement)', () => {
		// need = 100 × 1 = 100, have = 250 → 2.5 days
		expect(daysOfSupply(row('multiply', 1, 250))).toBe(2.5);
	});
	it('null for divide, threshold, missing stock, and zero need', () => {
		expect(daysOfSupply(row('divide', 10, 5))).toBeNull();
		expect(daysOfSupply(row('threshold', 30, 25))).toBeNull();
		expect(daysOfSupply(row('multiply', 1, null))).toBeNull(); // stock unsynced
		expect(daysOfSupply(row('multiply', 1, 5, 0))).toBeNull(); // occupancy 0 → need 0
	});
});

describe('rowSeverity — consumables (multiply, days-of-supply lens)', () => {
	it('crit when < 3 days', () => {
		expect(rowSeverity(row('multiply', 1, 200))).toBe('crit'); // 2 days
	});
	it('watch when 3–7 days', () => {
		expect(rowSeverity(row('multiply', 1, 500))).toBe('watch'); // 5 days
	});
	it('ok when ≥ 7 days', () => {
		expect(rowSeverity(row('multiply', 1, 1000))).toBe('ok'); // 10 days
	});
	it('nodata when a valid multiply row has zero need', () => {
		expect(rowSeverity(row('multiply', 1, 0, 0))).toBe('nodata');
	});
});

describe('rowSeverity — facilities (divide, shortfall lens)', () => {
	it('crit when shortfall ≥ 40%', () => {
		// need = ceil(100/10) = 10, have = 1 → gap 9 → shortfall 0.9
		expect(rowSeverity(row('divide', 10, 1))).toBe('crit');
	});
	it('watch on a small shortfall', () => {
		// need 10, have 8 → gap 2 → shortfall 0.2
		expect(rowSeverity(row('divide', 10, 8))).toBe('watch');
	});
	it('ok on surplus', () => {
		// need 10, have 20 → surplus
		expect(rowSeverity(row('divide', 10, 20))).toBe('ok');
	});
	it('treats a persisted gap row with zero shortfall as inconsistent data', () => {
		const computed = row('divide', 10, 10);
		const syntheticGap = {
			...computed,
			status: 'gap' as const,
			gap: '0'
		};
		expect(rowSeverity(syntheticGap)).toBe('nodata');
	});
	it('never presents a persisted gap row with missing need/gap as green', () => {
		const computed = row('divide', 10, 10);
		const syntheticMissing = {
			...computed,
			status: 'gap' as const,
			need: null,
			gap: null
		};
		expect(rowSeverity(syntheticMissing)).toBe('nodata');
	});
});

describe('rowSeverity — non-quantity + incomplete data', () => {
	it('threshold → constraint', () => {
		expect(rowSeverity(row('threshold', 30, 25))).toBe('constraint');
	});
	it('ratio missing → nodata', () => {
		expect(rowSeverity(row('multiply', null, 100))).toBe('nodata');
	});
	it('stock unsynced (have null) → nodata', () => {
		expect(rowSeverity(row('multiply', 1, null))).toBe('nodata');
	});
});

describe('summarizeStatuses', () => {
	it('counts each severity and total', () => {
		const results = [
			row('multiply', 1, 200), // crit
			row('multiply', 1, 500), // watch
			row('multiply', 1, 1000), // ok
			row('threshold', 30, 25), // constraint
			row('multiply', null, 100) // nodata
		];
		expect(summarizeStatuses(results)).toEqual({
			crit: 1,
			watch: 1,
			ok: 1,
			constraint: 1,
			nodata: 1,
			total: 5
		});
	});
});

describe('sortBySeverity', () => {
	it('orders most-severe first and is stable on ties by ordinal', () => {
		const ok = row('multiply', 1, 1000);
		const crit = row('multiply', 1, 200);
		const watch = row('multiply', 1, 500);
		const sorted = sortBySeverity([ok, crit, watch]);
		expect(sorted.map((r) => rowSeverity(r))).toEqual(['crit', 'watch', 'ok']);
		expect(SEVERITY_RANK.crit).toBeLessThan(SEVERITY_RANK.ok);
	});
	it('keeps ordinal order when severity ties', () => {
		const first = row('multiply', 1, 200);
		const second = { ...first, ordinal: first.ordinal + 1 };
		expect(sortBySeverity([second, first]).map((r) => r.ordinal)).toEqual([
			first.ordinal,
			second.ordinal
		]);
	});
});
