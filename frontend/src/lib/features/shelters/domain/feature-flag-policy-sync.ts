/**
 * Bidirectional sync between registration feature_flags and shelter policies.
 *
 * Registration steps (pets / assets / vehicles) are gated by feature_flags;
 * shelter form policies are the operator-facing source of truth for "does this
 * centre accept / track X?". Flipping either side keeps the other consistent.
 *
 * Mapping (CR-016 flags ↔ CR-023 policies):
 * - allow_pets     ↔ admission_policy.pet_policy.policy === 'conditional'
 * - allow_vehicles ↔ parking_policy.availability === 'available'
 * - allow_assets   ↔ luggage_policy.limitation is set (no_limit | limited)
 */
import {
	DEFAULT_SHELTER_FEATURE_FLAGS,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	type AdmissionPolicy,
	type LuggagePolicy,
	type ParkingPolicy,
	type ShelterFeatureFlags
} from './schema';

export function patchFeatureFlags(
	current: ShelterFeatureFlags | null | undefined,
	patch: Partial<ShelterFeatureFlags>
): ShelterFeatureFlags {
	return {
		...DEFAULT_SHELTER_FEATURE_FLAGS,
		...current,
		...patch
	};
}

export type PolicySyncSlice = {
	feature_flags: ShelterFeatureFlags;
	admission_policy: AdmissionPolicy;
	luggage_policy: LuggagePolicy;
	parking_policy: ParkingPolicy;
};

function ensureAdmission(policy: AdmissionPolicy | null | undefined): AdmissionPolicy {
	return {
		...EMPTY_ADMISSION_POLICY,
		...policy,
		pet_policy: {
			...EMPTY_ADMISSION_POLICY.pet_policy,
			...(policy?.pet_policy ?? {})
		}
	};
}

function ensureLuggage(policy: LuggagePolicy | null | undefined): LuggagePolicy {
	return { ...EMPTY_LUGGAGE_POLICY, ...policy };
}

function ensureParking(policy: ParkingPolicy | null | undefined): ParkingPolicy {
	return { ...EMPTY_PARKING_POLICY, ...policy };
}

/** Turn registration pets on/off and mirror pet_policy. */
export function applyAllowPets(
	slice: Partial<PolicySyncSlice>,
	allow: boolean
): Pick<PolicySyncSlice, 'feature_flags' | 'admission_policy'> {
	const admission = ensureAdmission(slice.admission_policy);
	if (allow) {
		const keepCategories = admission.pet_policy?.policy === 'conditional';
		return {
			feature_flags: patchFeatureFlags(slice.feature_flags, { allow_pets: true }),
			admission_policy: {
				...admission,
				pet_policy: {
					policy: 'conditional',
					categories: keepCategories ? (admission.pet_policy?.categories ?? []) : []
				}
			}
		};
	}
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, { allow_pets: false }),
		admission_policy: {
			...admission,
			pet_policy: { policy: 'no_pets', categories: [] }
		}
	};
}

/** Pet policy radio → allow_pets. */
export function applyPetPolicy(
	slice: Partial<PolicySyncSlice>,
	policy: 'no_pets' | 'conditional'
): Pick<PolicySyncSlice, 'feature_flags' | 'admission_policy'> {
	const admission = ensureAdmission(slice.admission_policy);
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, {
			allow_pets: policy === 'conditional'
		}),
		admission_policy: {
			...admission,
			pet_policy: {
				policy,
				categories: policy === 'conditional' ? (admission.pet_policy?.categories ?? []) : []
			}
		}
	};
}

/** Turn registration assets on/off and mirror luggage limitation. */
export function applyAllowAssets(
	slice: Partial<PolicySyncSlice>,
	allow: boolean
): Pick<PolicySyncSlice, 'feature_flags' | 'luggage_policy'> {
	if (allow) {
		const luggage = ensureLuggage(slice.luggage_policy);
		return {
			feature_flags: patchFeatureFlags(slice.feature_flags, { allow_assets: true }),
			luggage_policy: {
				...luggage,
				limitation: luggage.limitation ?? 'no_limit'
			}
		};
	}
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, { allow_assets: false }),
		luggage_policy: { ...EMPTY_LUGGAGE_POLICY }
	};
}

/** Luggage limitation radio → allow_assets (any set limitation enables). */
export function applyLuggageLimitation(
	slice: Partial<PolicySyncSlice>,
	limitation: 'no_limit' | 'limited'
): Pick<PolicySyncSlice, 'feature_flags' | 'luggage_policy'> {
	const luggage = ensureLuggage(slice.luggage_policy);
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, { allow_assets: true }),
		luggage_policy: {
			...luggage,
			limitation,
			max_per_family: limitation === 'limited' ? luggage.max_per_family : null
		}
	};
}

/** Turn registration vehicles on/off and mirror parking availability. */
export function applyAllowVehicles(
	slice: Partial<PolicySyncSlice>,
	allow: boolean
): Pick<PolicySyncSlice, 'feature_flags' | 'parking_policy'> {
	if (allow) {
		const parking = ensureParking(slice.parking_policy);
		return {
			feature_flags: patchFeatureFlags(slice.feature_flags, { allow_vehicles: true }),
			parking_policy: {
				...parking,
				availability: 'available'
			}
		};
	}
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, { allow_vehicles: false }),
		parking_policy: { ...EMPTY_PARKING_POLICY, availability: 'none' }
	};
}

/** Parking availability radio → allow_vehicles. */
export function applyParkingAvailability(
	slice: Partial<PolicySyncSlice>,
	availability: 'none' | 'available'
): Pick<PolicySyncSlice, 'feature_flags' | 'parking_policy'> {
	if (availability === 'none') {
		return {
			feature_flags: patchFeatureFlags(slice.feature_flags, { allow_vehicles: false }),
			parking_policy: { ...EMPTY_PARKING_POLICY, availability: 'none' }
		};
	}
	const parking = ensureParking(slice.parking_policy);
	return {
		feature_flags: patchFeatureFlags(slice.feature_flags, { allow_vehicles: true }),
		parking_policy: {
			...parking,
			availability: 'available'
		}
	};
}
