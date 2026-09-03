/**
 * Residence-suggest dependency snapshot for Station 1.
 *
 * Svelte `$effect` only tracks properties read *synchronously*. Nested binds
 * mutate `form.address_no` etc. without reassigning `form`, so reading the
 * object identity alone never re-runs the effect (see Svelte `$effect` docs).
 * Household list data must also be read outside `setTimeout`.
 */
import {
	hasMinimumResidence,
	suggestHouseholdsByResidence,
	type HouseholdChoice,
	type ResidenceFields,
	type ResidenceMatchCandidate
} from '../domain/registration-shell';

export type ResidenceSuggestDeps = {
	choice: HouseholdChoice;
	form: ResidenceFields;
	households: readonly ResidenceMatchCandidate[];
	householdsLoading: boolean;
};

export function readResidenceSuggestDeps(
	choice: HouseholdChoice,
	form: ResidenceFields,
	households: readonly ResidenceMatchCandidate[],
	householdsLoading: boolean
): ResidenceSuggestDeps {
	return {
		choice,
		form: {
			address_no: form.address_no,
			village_no: form.village_no,
			subdistrict: form.subdistrict,
			district: form.district,
			province: form.province,
			postal_code: form.postal_code
		},
		households,
		householdsLoading
	};
}

export type ResidenceSuggestTick =
	{ kind: 'clear' } | { kind: 'pending' } | { kind: 'result'; matches: ResidenceMatchCandidate[] };

/**
 * Pure decision for one suggest tick after deps are snapshotted.
 * Debounce timing stays in the UI `$effect`.
 */
export function residenceSuggestTick(deps: ResidenceSuggestDeps): ResidenceSuggestTick {
	if (deps.choice !== 'create' && deps.choice !== 'change_residence') {
		return { kind: 'clear' };
	}
	if (!hasMinimumResidence(deps.form)) {
		return { kind: 'clear' };
	}
	if (deps.householdsLoading) {
		return { kind: 'pending' };
	}
	return {
		kind: 'result',
		matches: suggestHouseholdsByResidence(deps.form, deps.households)
	};
}
