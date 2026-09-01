import { describe, expect, it } from 'vitest';
import { SOP_RATIO_KEYS, SOP_RATIO_KIND, type SopRatioKey } from '$lib/features/sop-ratios';
import type { CalculationSnapshot } from '$lib/features/resource-calc';
import { runSimulation } from './application/use-run-simulation';

const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '10'])) as Record<
	SopRatioKey,
	string
>;

const floodSnapshot: CalculationSnapshot = {
	shelter_code: 'SH001',
	as_of: '2026-08-17T03:00:00.000Z',
	formula_v: '2.0.0',
	profile: {
		effective_id: 'sop_profile:sphere',
		effective_version: 3,
		ratio_source: 'master',
		base_profile_id: null,
		override_id: null,
		override_version: null
	},
	current_occupancy: 500,
	current_ratios: ratios,
	resource_inputs: SOP_RATIO_KEYS.map((key) => ({
		key,
		kind: SOP_RATIO_KIND[key],
		ratio: ratios[key],
		have: key.startsWith('max_') ? null : '1000'
	})),
	stock_snapshot: Object.fromEntries(
		SOP_RATIO_KEYS.map((key) => [key, key.startsWith('max_') ? null : '1000'])
	)
};

describe('T-42 flood demo — 2,000 people for 14 days', () => {
	it('uses T-31 daily results and projects the shared 14-day horizon', async () => {
		const result = await runSimulation(
			{
				name: 'น้ำท่วมต่อเนื่อง 14 วัน',
				occupancy: 2000,
				days: 14,
				ratio_overrides: { water_l_per_person_day: '15' }
			},
			'SH001',
			async () => structuredClone(floodSnapshot)
		);
		const water = result.comparison.find((row) => row.key === 'water_l_per_person_day');
		const toilets = result.comparison.find((row) => row.key === 'people_per_toilet_female');

		expect(water).toMatchObject({
			current_daily_need: '5000',
			scenario_daily_need: '30000',
			current_horizon_need: '70000',
			scenario_horizon_need: '420000',
			current_horizon_gap: '69000',
			scenario_horizon_gap: '419000',
			gap_delta: '350000',
			ratio_overridden: true
		});
		expect(toilets).toMatchObject({
			current_daily_need: '50',
			scenario_daily_need: '200',
			current_horizon_need: '50',
			scenario_horizon_need: '200'
		});
	});
});
