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
	ratio: string | number | null,
	have: string | number | null
): ResourceInput => ({
	key,
	kind,
	ratio: ratio != null ? String(ratio) : null,
	have: have != null ? String(have) : null
});

describe('calculateResources — happy path', () => {
	it('multiply matches hand calc (occupancy × ratio) and gap = need − have', () => {
		const [row] = calc(120, [r('water', 'multiply', 15, 1000)]);
		expect(row.need).toBe('1800');
		expect(row.gap).toBe('800');
		expect(row.status).toBe('gap');
		expect(row.input_valid).toBe(true);
	});

	it('divide uses ceil — acceptance: ratio 50, occupancy 120 → need 3', () => {
		const [row] = calc(120, [r('volunteer', 'divide', 50, null)]);
		expect(row.need).toBe('3');
	});

	it('threshold → constraint; need/gap null; have + ratio echoed', () => {
		const [row] = calc(100, [r('max_queue_minutes', 'threshold', 30, 25)]);
		expect(row.status).toBe('constraint');
		expect(row.need).toBeNull();
		expect(row.gap).toBeNull();
		expect(row.ratio).toBe('30');
		expect(row.have).toBe('25'); // informational, echoed, does not affect status
		expect(row.input_valid).toBe(true);
	});

	it('have = 0 → gap equals need, status gap', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, 0)]);
		expect(row.need).toBe('150');
		expect(row.gap).toBe('150');
		expect(row.status).toBe('gap');
	});

	it('have > need → surplus', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, 1000)]);
		expect(row.status).toBe('surplus');
		expect(row.gap).toBe('-850');
	});

	it('have null → insufficient_data (need still computed), input_valid true', () => {
		const [row] = calc(10, [r('water', 'multiply', 15, null)]);
		expect(row.status).toBe('insufficient_data');
		expect(row.need).toBe('150');
		expect(row.gap).toBeNull();
		expect(row.input_valid).toBe(true);
	});

	it('occupancy = 0 → need 0 (no crash)', () => {
		const [row] = calc(0, [r('water', 'multiply', 15, 0)]);
		expect(row.need).toBe('0');
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
			ratio: '15',
			need: '1800',
			have: '1000',
			gap: '800',
			status: 'gap',
			data_status: 'complete',
			as_of: AS_OF
		});
		expect(results[1]).toEqual({
			ordinal: 1,
			key: 'toilet_f',
			kind: 'divide',
			input_valid: true,
			ratio: '20',
			need: '6', // ceil(120 / 20)
			have: '4',
			gap: '2',
			status: 'gap',
			data_status: 'complete',
			as_of: AS_OF
		});
		expect(results[2]).toEqual({
			ordinal: 2,
			key: 'max_queue',
			kind: 'threshold',
			input_valid: true,
			ratio: '30',
			need: null,
			have: '25',
			gap: null,
			status: 'constraint',
			data_status: 'complete',
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
		const [mul] = calc(1e308, [r('m', 'multiply', '1e308', null)]);
		expect(mul.need).toBeNull();
		expect(mul.input_valid).toBe(false);

		const [div] = calc(1e308, [r('d', 'divide', '1e-308', null)]);
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

describe('calculateResources — decimal precision vs status', () => {
	it('decimal math does not flip ok→gap; rounded need/gap wash residue', () => {
		// 3 × 0.1 = 0.3; need '0.3' − have '0.3' → gap '0' → ok
		const [row] = calc(3, [r('x', 'multiply', '0.1', '0.3')]);
		expect(row.status).toBe('ok');
		expect(row.need).toBe('0.3');
		expect(row.gap).toBe('0');
	});

	it('multiply result is rounded to quantity decimals', () => {
		const [row] = calc(3, [r('x', 'multiply', '0.2', null)]);
		expect(row.need).toBe('0.6');
	});

	it('large-magnitude near-equal: decimal math handles it without noise, status stays ok', () => {
		const [row] = calc(1, [r('x', 'multiply', '1000000', '1000000')]);
		expect(row.status).toBe('ok');
		expect(row.gap).toBe('0');
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
		expect(rows.map((x) => x.need)).toEqual(['1000', '2000', '3000']);
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

	it('exports FORMULA_V = 2.0.0 and carries as_of through unchanged', () => {
		expect(FORMULA_V).toBe('2.0.0');
		const [row] = calc(10, [r('water', 'multiply', 15, null)], '2026-01-01T00:00:00.000Z');
		expect(row.as_of).toBe('2026-01-01T00:00:00.000Z');
	});

	it('large divide result stays finite', () => {
		const [row] = calc(1, [r('vol', 'divide', '1e-12', null)]);
		expect(row.need).toBe('1000000000000');
		expect(row.input_valid).toBe(true);
		expect(row.status).toBe('insufficient_data'); // have unresolved, not an overflow
	});
});

describe('calculateResources — T-31.3 edge-case data_status (data-availability axis)', () => {
	// The two "business" edge cases: handled correctly AND stay `complete` (valid results, not missing data).
	it('occupancy = 0 → status ok, need 0, data_status complete (not an anomaly)', () => {
		const [row] = calc(0, [r('water', 'multiply', 15, 0)]);
		expect(row.status).toBe('ok');
		expect(row.need).toBe('0');
		expect(row.data_status).toBe('complete');
		expect(row.input_valid).toBe(true);
	});

	it('stock = 0 (have 0) → status gap, gap === need, data_status complete', () => {
		const [row] = calc(120, [r('water', 'multiply', 15, 0)]);
		expect(row.status).toBe('gap');
		expect(row.gap).toBe(row.need);
		expect(row.data_status).toBe('complete');
	});

	// The two "availability" edge cases: distinguished by data_status under a shared status.
	it('ratio missing → insufficient_data + data_status ratio_missing (input_valid true)', () => {
		const [row] = calc(120, [r('water', 'multiply', null, 500)]);
		expect(row.status).toBe('insufficient_data');
		expect(row.data_status).toBe('ratio_missing');
		expect(row.input_valid).toBe(true);
		expect(row.need).toBeNull();
	});

	it('stock unsynced (have null) → insufficient_data + data_status stock_unsynced (need computed)', () => {
		const [row] = calc(120, [r('water', 'multiply', 15, null)]);
		expect(row.status).toBe('insufficient_data');
		expect(row.data_status).toBe('stock_unsynced');
		expect(row.need).toBe('1800');
	});

	it('distinguishability: ratio_missing vs stock_unsynced share status but differ in data_status', () => {
		const [missingRatio, unsynced] = calc(120, [
			r('a', 'multiply', null, 500),
			r('b', 'multiply', 15, null)
		]);
		expect(missingRatio.status).toBe('insufficient_data');
		expect(unsynced.status).toBe('insufficient_data');
		expect(missingRatio.data_status).toBe('ratio_missing');
		expect(unsynced.data_status).toBe('stock_unsynced');
	});

	it('precedence: have=null on an occupancy=0 row → stock_unsynced (branch 4 before gap branch)', () => {
		const [row] = calc(0, [r('water', 'multiply', 15, null)]);
		expect(row.data_status).toBe('stock_unsynced');
	});

	it('invalid input → data_status invalid_input', () => {
		const rows = calc(100, [
			r('a', 'multiply', -5, 10), // bad ratio
			r('b', 'divide', 0, 10), // divide-by-zero
			r('c', 'multiply', 15, -5) // bad have
		]);
		for (const row of rows) {
			expect(row.data_status).toBe('invalid_input');
			expect(row.input_valid).toBe(false);
		}
	});

	// Invariant 1: invalid_input mirrors !input_valid exactly.
	it('invariant: (data_status === invalid_input) === !input_valid, every row', () => {
		const rows = calc(120, [
			r('ok', 'multiply', 15, 100),
			r('miss', 'multiply', null, 100),
			r('unsynced', 'divide', 20, null),
			r('bad', 'multiply', -1, 100),
			r('thr', 'threshold', 30, 10)
		]);
		for (const row of rows) {
			expect(row.data_status === 'invalid_input').toBe(!row.input_valid);
		}
	});

	// Invariant 2: the two axes are coupled as a biconditional — written as two directional assertions
	// (v1.1.0 contract; adding a data_status that co-occurs with a non-insufficient_data status is a
	// FORMULA_V change that revisits these).
	const mixed = () =>
		calc(120, [
			r('ok', 'multiply', 15, 100), // ok / complete
			r('gap', 'multiply', 15, 0), // gap / complete
			r('miss', 'multiply', null, 100), // insufficient_data / ratio_missing
			r('unsynced', 'divide', 20, null), // insufficient_data / stock_unsynced
			r('bad', 'multiply', -1, 100), // insufficient_data / invalid_input
			r('thr', 'threshold', 30, 10) // constraint / complete
		]);

	it('invariant forward: status insufficient_data ⇒ data_status !== complete', () => {
		for (const row of mixed()) {
			if (row.status === 'insufficient_data') expect(row.data_status).not.toBe('complete');
		}
	});

	it('invariant backward: data_status !== complete ⇒ status insufficient_data', () => {
		for (const row of mixed()) {
			if (row.data_status !== 'complete') expect(row.status).toBe('insufficient_data');
		}
	});
});

describe('calculateResources — T-31.9 idempotency (pure function, same input ⇒ same output)', () => {
	it('calling calculateResources twice with the same input yields identical output', () => {
		const input: CalcInput = {
			occupancy: 120,
			as_of: AS_OF,
			resources: [
				r('water', 'multiply', 15, 1000), // ok/gap path
				r('toilet_f', 'divide', 20, 4), // divide/ceil path
				r('max_queue', 'threshold', 30, 25), // constraint path
				r('missing_ratio', 'multiply', null, 500), // ratio_missing path
				r('unsynced', 'divide', 10, null), // stock_unsynced path
				r('bad', 'multiply', -1, 100) // invalid_input path
			]
		};

		expect(calculateResources(input)).toEqual(calculateResources(input));
	});

	it('idempotent across kinds/statuses individually (not just array-level equality)', () => {
		const input: CalcInput = {
			occupancy: 0,
			as_of: AS_OF,
			resources: [r('water', 'multiply', 15, 0)]
		};

		const first = calculateResources(input);
		const second = calculateResources(input);

		expect(first).toHaveLength(second.length);
		first.forEach((row, i) => expect(row).toEqual(second[i]));
	});
});
