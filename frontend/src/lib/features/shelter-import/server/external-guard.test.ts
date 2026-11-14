import { describe, expect, it } from 'vitest';
import { externalForbiddenKeysFilled } from './external-guard';

/** What the importer emits for an external row whose other sheets are empty. */
const untouched = {
	facilities: { toilets_male: undefined, car_toilet_accessible: null, car_toilet_supported: null },
	common_areas: { central_kitchen: false, parking_capacity: undefined, sub_storage: [] },
	utilities: { power_source: null, water_source: null, communications: {}, vhf_channel: null },
	risk: { elevation_m: undefined, constraints: null },
	admission_policy: {
		supported_vulnerable_groups: [],
		pet_policy: { policy: null, categories: [] }
	},
	luggage_policy: { limitation: null, max_per_family: null, rules: [], rules_other: null },
	parking_policy: { availability: null, supported_vehicles: [], rules: [], rules_other: null }
};

describe('externalForbiddenKeysFilled', () => {
	it('accepts the untouched sections an external row carries', () => {
		expect(externalForbiddenKeysFilled(untouched)).toEqual([]);
	});

	it('accepts rows with the sections missing altogether', () => {
		expect(externalForbiddenKeysFilled({})).toEqual([]);
	});

	it('flags real data in utilities, risk and policy sections', () => {
		const filled = {
			...untouched,
			utilities: { ...untouched.utilities, power_source: 'generator' },
			risk: { ...untouched.risk, constraints: 'ที่ลุ่ม' },
			admission_policy: {
				...untouched.admission_policy,
				pet_policy: { policy: 'allowed', categories: [] }
			}
		};
		expect(externalForbiddenKeysFilled(filled).sort()).toEqual([
			'admission_policy',
			'risk',
			'utilities'
		]);
	});
});
