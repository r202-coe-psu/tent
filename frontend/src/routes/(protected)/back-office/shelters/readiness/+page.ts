import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { getShelterCode } from '$lib/db/shelter';
import type { PageLoad } from './$types';

export const load = (async () => {
	const code = shelterStore.selectedShelterCode ?? getShelterCode();
	if (code) {
		redirect(302, resolve(`/back-office/shelters/readiness/${encodeURIComponent(code)}`));
	}
	return { code };
}) satisfies PageLoad;
