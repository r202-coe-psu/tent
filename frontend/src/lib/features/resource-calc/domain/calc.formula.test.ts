import { describe, it, expect } from 'vitest';
import {
	calculateResources,
	FORMULA_V,
	type CalcInput,
	type ResourceInput,
	type ResourceKind
} from './calc.formula';

const AS_OF = '2026-07-03T00:00:00.000Z';

const calc = (occupancy: number, resources: ResourceInput[], as_of: string = AS_OF) =>
	calculateResources({ occupancy, as_of, resources } as CalcInput);

const r = (
	key: string,
	kind: ResourceKind,
	ratio: number | null,
	have: number | null
): ResourceInput => ({ key, kind, ratio, have });

describe('calculateResources — happy path', () => {
	it('multiply matches hand calc (occupancy × ratio) and gap = need − have', () => {
		const [row] = calc(120, [r('water', 'multiply', 15, 1000)]);
		expect(row.need).toBe(1800);
		expect(row.gap).toBe(800);
		expect(row.status).toBe('gap');
		expect(row.input_valid).toBe(true);
	});

	it('divide uses ceil — acceptance: ratio 50, occupancy 120 → need 3', () => {
		const [row] = calc(120, [r('volunteer', 'divide', 50, null)]);
		expect(row.need).toBe(3);
	});

	it('threshold → constraint; need/gap null; have + ratio echoed', () => {
		const [row] = calc(100, [r('max_queue_minutes', 'threshold', 30, 25)]);
		expect(row.status).toBe('constraint');
		expect(row.need).toBeNull();
		expect(row.gap).toBeNull();
		expect(row.ratio).toBe(30);
		expect(row.have).toBe(25); // informational, echoed, does not affect status
		expect(row.input_valid).toBe(true);
	});

	it('have = 0 → gap equals need, status gap', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, 0)]);
		expect(row.need).toBe(150);
		expect(row.gap).toBe(150);
		expect(row.status).toBe('gap');
	});

	it('have > need → surplus', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, 1000)]);
		expect(row.status).toBe('surplus');
		expect(row.gap).toBe(-850);
	});

	it('have null → insufficient_data (need still computed), input_valid true', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, null)]);
		expect(row.status).toBe('insufficient_data');
		expect(row.need).toBe(150);
		expect(row.gap).toBeNull();
		expect(row.input_valid).toBe(true);
	});

	it('occupancy = 0 → need 0 (no crash)', () => {
		const [row] = calc(0, [r('water', 'multiply', 15, 0)]);
		expect(row.need).toBe(0);
		expect(row.status).toBe('ok');
	});

	it('full mixed-kind demo asserted field-by-field (DoD hand calc)', () => {
		const results = calc(120, [
			r('water', 'multiply', 15, 1000),
			r('toilet_f', 'divide', 20, 4),
			r('max_queue', 'threshold', 30, 25)
		]);

		expect(results[0]).toEqual({
			ordinal: 0,
			key: 'water',
			kind: 'multiply',
			input_valid: true,
			ratio: 15,
			need: 1800,
			have: 1000,
			gap: 800,
			status: 'gap',
			as_of: AS_OF
		});
		expect(results[1]).toEqual({
			ordinal: 1,
			key: 'toilet_f',
			kind: 'divide',
			input_valid: true,
			ratio: 20,
			need: 6, // ceil(120 / 20)
			have: 4,
			gap: 2,
			status: 'gap',
			as_of: AS_OF
		});
		expect(results[2]).toEqual({
			ordinal: 2,
			key: 'max_queue',
			kind: 'threshold',
			input_valid: true,
			ratio: 30,
			need: null,
			have: 25,
			gap: null,
			status: 'constraint',
			as_of: AS_OF
		});
	});
});

describe('calculateResources — validity axis (input_valid=false, status=insufficient_data)', () => {
	const badOccupancies: Array<[string, number]> = [
		['negative', -5],
		['NaN', Number.NaN],
		['Infinity', Number.POSITIVE_INFINITY],
		['null', null as unknown as number],
		['undefined', undefined as unknown as number]
	];

	it.each(badOccupancies)('occupancy %s → every row invalid', (_label, occ) => {
		const rows = calc(occ, [r('water', 'multiply', 15, 1000), r('vol', 'divide', 50, 2)]);
		for (const row of rows) {
			expect(row.input_valid).toBe(false);
			expect(row.status).toBe('insufficient_data');
			expect(row.need).toBeNull();
			expect(row.gap).toBeNull();
		}
	});

	it('ratio ≤ 0 / NaN is invalid — including on a threshold (validity beats kind)', () => {
		const rows = calc(100, [
			r('a', 'multiply', -5, 10),
			r('b', 'divide', 0, 10), // divide-by-zero prevented
			r('c', 'multiply', Number.NaN, 10),
			r('d', 'threshold', -5, 10)
		]);
		for (const row of rows) {
			expect(row.input_valid).toBe(false);
			expect(row.status).toBe('insufficient_data');
			expect(row.need).toBeNull();
		}
	});

	it('have < 0 / NaN / Infinity is invalid — including on a threshold', () => {
		const rows = calc(100, [
			r('a', 'multiply', 15, -5),
			r('b', 'multiply', 15, Number.NaN),
			r('c', 'divide', 20, Number.POSITIVE_INFINITY),
			r('d', 'threshold', 30, -1)
		]);
		for (const row of rows) {
			expect(row.input_valid).toBe(false);
			expect(row.status).toBe('insufficient_data');
		}
	});

	it('overflow (multiply and divide) → need null, input_valid false (no Infinity leak)', () => {
		const [mul] = calc(1e308, [r('m', 'multiply', 1e308, null)]);
		expect(mul.need).toBeNull();
		expect(mul.input_valid).toBe(false);

		const [div] = calc(1e308, [r('d', 'divide', 1e-308, null)]);
		expect(div.need).toBeNull();
		expect(div.input_valid).toBe(false);
	});
});

describe('calculateResources — absent vs invalid', () => {
	it('ratio null → input_valid true + insufficient_data (missing, not wrong)', () => {
		const [row] = calc(100, [r('water', 'multiply', null, 500)]);
		expect(row.input_valid).toBe(true);
		expect(row.status).toBe('insufficient_data');
		expect(row.need).toBeNull();
		expect(row.gap).toBeNull();
	});
});

describe('calculateResources — floating point vs status', () => {
	it('float noise does not flip ok→gap; gap stays raw', () => {
		// 3 × 0.1 = 0.30000000000000004; have 0.3 → |gap| < GAP_EPSILON → ok
		const [row] = calc(3, [r('x', 'multiply', 0.1, 0.3)]);
		expect(row.status).toBe('ok');
		expect(row.need).toBeCloseTo(0.3);
		expect(row.gap).not.toBe(0); // RAW residual retained
		expect(Math.abs(row.gap as number)).toBeLessThan(1e-9);
	});

	it('multiply result is raw (no rounding)', () => {
		const [row] = calc(3, [r('x', 'multiply', 0.2, null)]);
		expect(row.need).toBeCloseTo(0.6);
	});

	it('large-magnitude near-equal: representation noise only, status stays ok', () => {
		// Derived (not a hand-written literal) so the noise is provably real, not coincidental:
		// mathematically 1_000_000, but 0.1 + 0.2 - 0.3 !== 0 in binary floating point.
		const noisyNeed = 1_000_000 + (0.1 + 0.2 - 0.3);
		const [row] = calc(1, [r('x', 'multiply', noisyNeed, 1_000_000)]);
		expect(row.status).toBe('ok');
		expect(row.gap).not.toBeNull();
		// 1e-9 intentionally duplicates GAP_EPSILON (private/unexported) — this test documents the
		// public tolerance behavior, not the implementation; if GAP_EPSILON ever changes, update both.
		expect(Math.abs(row.gap as number)).toBeLessThan(1e-9);
	});
});

describe('calculateResources — structural', () => {
	it('empty resources → []', () => {
		expect(calc(100, [])).toEqual([]);
	});

	it('invalid occupancy + empty resources → [] (no throw, empty wins)', () => {
		expect(calc(-5, [])).toEqual([]);
	});

	it('preserves input order and assigns ordinal by index', () => {
		const rows = calc(100, [
			r('a', 'multiply', 1, null),
			r('b', 'multiply', 2, null),
			r('c', 'multiply', 3, null)
		]);
		expect(rows.map((x) => x.key)).toEqual(['a', 'b', 'c']);
		expect(rows.map((x) => x.ordinal)).toEqual([0, 1, 2]);
	});

	it('duplicate keys pass through 1:1 with distinct ordinals', () => {
		const rows = calc(100, [
			r('water', 'multiply', 10, null),
			r('water', 'multiply', 20, null),
			r('water', 'multiply', 30, null)
		]);
		expect(rows).toHaveLength(3);
		expect(rows.map((x) => x.ordinal)).toEqual([0, 1, 2]);
		expect(rows.map((x) => x.need)).toEqual([1000, 2000, 3000]);
	});

	it('unknown kind (via cast) throws with the expected message', () => {
		const bad = [r('x', 'percentage' as unknown as ResourceKind, 1, 1)];
		expect(() => calc(10, bad)).toThrow(/Unhandled ResourceKind: percentage/);
	});

	it('returns fresh objects and never mutates input', () => {
		const input: CalcInput = {
			occupancy: 100,
			as_of: AS_OF,
			resources: [r('water', 'multiply', 15, 500)]
		};
		const snapshot = structuredClone(input);
		const rows = calculateResources(input);
		expect(rows[0]).not.toBe(input.resources[0]); // fresh object
		expect(input).toEqual(snapshot); // input unchanged
	});

	it('exports FORMULA_V = 1.0.0 and carries as_of through unchanged', () => {
		expect(FORMULA_V).toBe('1.0.0');
		const [row] = calc(10, [r('water', 'multiply', 15, null)], '2026-01-01T00:00:00.000Z');
		expect(row.as_of).toBe('2026-01-01T00:00:00.000Z');
	});

	it('large divide result stays finite (not an overflow-boundary probe)', () => {
		const [row] = calc(1, [r('vol', 'divide', 1e-12, null)]);
		expect(row.need).toBe(1e12);
		expect(Number.isFinite(row.need as number)).toBe(true);
		expect(row.input_valid).toBe(true);
		expect(row.status).toBe('insufficient_data'); // have unresolved, not an overflow
	});
});
