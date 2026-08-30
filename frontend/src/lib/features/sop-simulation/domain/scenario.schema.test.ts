import { describe, expect, it } from 'vitest';
import { calculationProfileSnapshotSchema, scenarioInputSchema } from './scenario.schema';

describe('scenarioInputSchema', () => {
	it('accepts a typed partial ratio override', () => {
		expect(
			scenarioInputSchema.parse({
				name: 'น้ำท่วม 14 วัน',
				occupancy: 2000,
				days: 14,
				ratio_overrides: { water_l_per_person_day: '15.5' }
			})
		).toMatchObject({ occupancy: 2000, days: 14 });
	});

	it.each([
		['fractional occupancy', { occupancy: 1.5 }],
		['zero days', { days: 0 }],
		['unknown ratio', { ratio_overrides: { unknown: '1' } }],
		['non-positive ratio', { ratio_overrides: { water_l_per_person_day: '0' } }]
	])('rejects %s', (_label, change) => {
		expect(() =>
			scenarioInputSchema.parse({
				name: 'scenario',
				occupancy: 10,
				days: 1,
				ratio_overrides: {},
				...change
			})
		).toThrow();
	});
});

describe('calculationProfileSnapshotSchema', () => {
	it('rejects mixed master/override provenance', () => {
		expect(() =>
			calculationProfileSnapshotSchema.parse({
				effective_id: 'sop_profile:master',
				effective_version: 3,
				ratio_source: 'override',
				base_profile_id: 'sop_profile:master',
				override_id: 'sop_override:01J',
				override_version: 4
			})
		).toThrow();
	});
});
