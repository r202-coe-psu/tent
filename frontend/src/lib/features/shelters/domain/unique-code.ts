/**
 * Shelter `code` is unique by invariant, but the registry does not enforce it: a stray
 * doc (e.g. a leftover import or mock) can repeat an existing code. UI lists key their
 * `{#each}` blocks by `code`, so one duplicate throws `each_key_duplicate` and the whole
 * list renders empty. Keep the first doc per code — the same one `getShelter` resolves.
 */
export function uniqueByShelterCode<T extends { code: string }>(shelters: readonly T[]): T[] {
	const seen = new Set<string>();
	return shelters.filter((shelter) => {
		if (seen.has(shelter.code)) return false;
		seen.add(shelter.code);
		return true;
	});
}
