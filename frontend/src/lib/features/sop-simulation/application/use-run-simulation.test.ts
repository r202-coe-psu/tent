import { describe, expect, it, vi } from 'vitest';
import { SOP_RATIO_KEYS, SOP_RATIO_KIND, type SopRatioKey } from '$lib/features/sop-ratios';
import type { CalculationSnapshot as ResourceCalculationSnapshot } from '$lib/features/resource-calc';
import { runSimulation } from './use-run-simulation';

const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '10'])) as Record<
	SopRatioKey,
	string
>;

function snapshot(): ResourceCalculationSnapshot {
	return {
		shelter_code: 'SH001',
		as_of: '2026-08-17T03:00:00.000Z',
		formula_v: '2.0.0',
		profile: {
			effective_id: 'sop_profile:master',
			effective_version: 3,
			ratio_source: 'master',
			base_profile_id: null,
			override_id: null,
			override_version: null
		},
		current_occupancy: 500,
		current_ratios: { ...ratios },
		resource_inputs: SOP_RATIO_KEYS.map((key) => ({
			key,
			kind: SOP_RATIO_KIND[key],
			ratio: ratios[key],
			have: key === 'max_queue_minutes' ? null : '1000'
		})),
		stock_snapshot: Object.fromEntries(
			SOP_RATIO_KEYS.map((key) => [key, key === 'max_queue_minutes' ? null : '1000'])
		)
	};
}

describe('runSimulation', () => {
	it('loads once, compares the same horizon, and leaves the active snapshot immutable', async () => {
		const source = snapshot();
		const before = structuredClone(source);
		const loader = vi.fn(async () => source);

		const result = await runSimulation(
			{
				name: 'น้ำท่วมต่อเนื่อง 14 วัน',
				occupancy: 2000,
				days: 14,
				ratio_overrides: { water_l_per_person_day: '15' }
			},
			'SH001',
			loader
		);

		expect(loader).toHaveBeenCalledTimes(1);
		expect(result.current.occupancy).toBe(500);
		expect(result.scenario.occupancy).toBe(2000);
		expect(result.current.ratios.water_l_per_person_day).toBe('10');
		expect(result.scenario.ratios.water_l_per_person_day).toBe('15');
		expect(result.input.days).toBe(14);
		expect(source).toEqual(before);
	});

	it('rejects unknown ratio keys before loading live data', async () => {
		const loader = vi.fn(async () => snapshot());
		await expect(
			runSimulation(
				{
					name: 'invalid',
					occupancy: 1,
					days: 1,
					ratio_overrides: { unknown: '1' }
				} as never,
				'SH001',
				loader
			)
		).rejects.toThrow();
		expect(loader).not.toHaveBeenCalled();
	});

	it('rejects a snapshot returned for a different shelter', async () => {
		const otherShelter = snapshot();
		otherShelter.shelter_code = 'SH002';
		await expect(
			runSimulation(
				{ name: 'cross shelter', occupancy: 10, days: 1, ratio_overrides: {} },
				'SH001',
				async () => otherShelter
			)
		).rejects.toThrow('does not match');
	});
});
