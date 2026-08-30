import { describe, expect, it } from 'vitest';
import type { ResourceCalcResult } from '$lib/features/resource-calc';
import { compareScenario, projectHorizon } from './scenario.projection';

const row = (overrides: Partial<ResourceCalcResult> = {}): ResourceCalcResult => ({
	ordinal: 0,
	key: 'water_l_per_person_day',
	kind: 'multiply',
	input_valid: true,
	ratio: '15',
	need: '150',
	have: '1000',
	gap: '-850',
	status: 'surplus',
	data_status: 'complete',
	as_of: '2026-08-17T03:00:00.000Z',
	...overrides
});

describe('projectHorizon', () => {
	it('multiplies daily resources by days and counts current stock once', () => {
		const [result] = projectHorizon([row()], 14);
		expect(result.horizon_need).toBe('2100');
		expect(result.horizon_gap).toBe('1100');
	});

	it('keeps concurrent capacity at the T-31 peak requirement', () => {
		const [result] = projectHorizon(
			[row({ key: 'people_per_toilet_female', kind: 'divide', need: '5', have: '3' })],
			14
		);
		expect(result.horizon_need).toBe('5');
		expect(result.horizon_gap).toBe('2');
	});

	it('does not create cumulative quantities for thresholds', () => {
		const [result] = projectHorizon(
			[
				row({
					key: 'max_queue_minutes',
					kind: 'threshold',
					need: null,
					have: null,
					gap: null,
					status: 'constraint'
				})
			],
			14
		);
		expect(result.horizon_need).toBeNull();
		expect(result.horizon_gap).toBeNull();
	});

	it('preserves insufficient stock as a null projected gap', () => {
		const [result] = projectHorizon([row({ have: null, gap: null })], 14);
		expect(result.horizon_need).toBe('2100');
		expect(result.horizon_gap).toBeNull();
	});
});

describe('compareScenario', () => {
	it('reports scenario-minus-current deltas and the override marker', () => {
		const current = [row()];
		const scenario = [row({ ratio: '20', need: '200', gap: '-800' })];
		const [comparison] = compareScenario(
			current,
			scenario,
			projectHorizon(current, 14),
			projectHorizon(scenario, 14),
			{ water_l_per_person_day: '20' }
		);
		expect(comparison.need_delta).toBe('700');
		expect(comparison.gap_delta).toBe('700');
		expect(comparison.ratio_overridden).toBe(true);
	});

	it('fails closed when T-31 row identity drifts', () => {
		const current = [row()];
		const scenario = [row({ key: 'cooking_water_l_per_person_day' })];
		expect(() =>
			compareScenario(
				current,
				scenario,
				projectHorizon(current, 1),
				projectHorizon(scenario, 1),
				{}
			)
		).toThrow('contract mismatch');
	});
});
