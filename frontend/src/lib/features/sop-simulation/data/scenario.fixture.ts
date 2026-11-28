import { SOP_RATIO_KEYS, SOP_RATIO_KIND, type SopRatioKey } from '$lib/features/sop-ratios';
import type { CalculationSnapshot } from '$lib/features/resource-calc';

/** Test fixture: a SH001 calculation snapshot with every ratio at 10 and 1000 of each stock. */
const ratios = Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '10'])) as Record<
	SopRatioKey,
	string
>;

export const scenarioSnapshotFixture: CalculationSnapshot = {
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
