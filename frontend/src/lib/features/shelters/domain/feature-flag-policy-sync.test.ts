import { describe, expect, it } from 'vitest';
import {
	applyAllowAssets,
	applyAllowPets,
	applyAllowVehicles,
	applyLuggageLimitation,
	applyParkingAvailability,
	applyPetPolicy,
	patchFeatureFlags
} from './feature-flag-policy-sync';
import {
	DEFAULT_SHELTER_FEATURE_FLAGS,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY
} from './schema';

describe('patchFeatureFlags', () => {
	it('merges onto defaults without wiping siblings', () => {
		expect(patchFeatureFlags({ allow_pets: true }, { allow_assets: true })).toEqual({
			...DEFAULT_SHELTER_FEATURE_FLAGS,
			allow_pets: true,
			allow_assets: true
		});
	});
});

describe('applyAllowPets / applyPetPolicy', () => {
	it('enables pets → conditional policy', () => {
		const r = applyAllowPets({}, true);
		expect(r.feature_flags.allow_pets).toBe(true);
		expect(r.admission_policy.pet_policy.policy).toBe('conditional');
		expect(r.admission_policy.pet_policy.categories).toEqual([]);
	});

	it('disables pets → no_pets and clears categories', () => {
		const r = applyAllowPets(
			{
				admission_policy: {
					supported_vulnerable_groups: ['vg1'],
					pet_policy: {
						policy: 'conditional',
						categories: [{ category: 'small_general', conditions: ['vaccine_book'] }]
					}
				}
			},
			false
		);
		expect(r.feature_flags.allow_pets).toBe(false);
		expect(r.admission_policy.pet_policy).toEqual({ policy: 'no_pets', categories: [] });
		expect(r.admission_policy.supported_vulnerable_groups).toEqual(['vg1']);
	});

	it('keeps categories when re-enabling while already conditional', () => {
		const cats = [{ category: 'large_dog' as const, conditions: ['muzzle_and_leash' as const] }];
		const r = applyAllowPets(
			{
				admission_policy: {
					...EMPTY_ADMISSION_POLICY,
					pet_policy: { policy: 'conditional', categories: cats }
				}
			},
			true
		);
		expect(r.admission_policy.pet_policy.categories).toEqual(cats);
	});

	it('pet policy radio syncs allow_pets', () => {
		expect(applyPetPolicy({}, 'conditional').feature_flags.allow_pets).toBe(true);
		expect(applyPetPolicy({}, 'no_pets').feature_flags.allow_pets).toBe(false);
		expect(applyPetPolicy({}, 'no_pets').admission_policy.pet_policy.categories).toEqual([]);
	});
});

describe('applyAllowAssets / applyLuggageLimitation', () => {
	it('enables assets → default no_limit when unset', () => {
		const r = applyAllowAssets({}, true);
		expect(r.feature_flags.allow_assets).toBe(true);
		expect(r.luggage_policy.limitation).toBe('no_limit');
	});

	it('keeps existing limitation when enabling', () => {
		const r = applyAllowAssets(
			{ luggage_policy: { ...EMPTY_LUGGAGE_POLICY, limitation: 'limited', max_per_family: 3 } },
			true
		);
		expect(r.luggage_policy.limitation).toBe('limited');
		expect(r.luggage_policy.max_per_family).toBe(3);
	});

	it('disables assets → clears luggage policy', () => {
		const r = applyAllowAssets(
			{
				luggage_policy: {
					limitation: 'limited',
					max_per_family: 2,
					rules: ['valuables_self_responsibility'],
					rules_other: 'x'
				}
			},
			false
		);
		expect(r.feature_flags.allow_assets).toBe(false);
		expect(r.luggage_policy).toEqual(EMPTY_LUGGAGE_POLICY);
	});

	it('setting luggage limitation enables allow_assets', () => {
		const r = applyLuggageLimitation({}, 'limited');
		expect(r.feature_flags.allow_assets).toBe(true);
		expect(r.luggage_policy.limitation).toBe('limited');
	});
});

describe('applyAllowVehicles / applyParkingAvailability', () => {
	it('enables vehicles → parking available', () => {
		const r = applyAllowVehicles({}, true);
		expect(r.feature_flags.allow_vehicles).toBe(true);
		expect(r.parking_policy.availability).toBe('available');
	});

	it('disables vehicles → none and clears subfields', () => {
		const r = applyAllowVehicles(
			{
				parking_policy: {
					availability: 'available',
					supported_vehicles: [{ type: 'car', max_capacity: 10 }],
					rules: ['no_liability'],
					rules_other: 'note'
				}
			},
			false
		);
		expect(r.feature_flags.allow_vehicles).toBe(false);
		expect(r.parking_policy).toEqual({ ...EMPTY_PARKING_POLICY, availability: 'none' });
	});

	it('parking availability radio syncs allow_vehicles', () => {
		expect(applyParkingAvailability({}, 'available').feature_flags.allow_vehicles).toBe(true);
		expect(applyParkingAvailability({}, 'none').feature_flags.allow_vehicles).toBe(false);
		expect(applyParkingAvailability({}, 'none').parking_policy.supported_vehicles).toEqual([]);
	});
});
