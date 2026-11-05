import { resolve } from '$app/paths';
import { redirect } from '@sveltejs/kit';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { getShelterCode } from '$lib/db/shelter';
import { requireManager } from '$lib/guards/auth';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireManager(fetch);
	const code = shelterStore.selectedShelterCode ?? getShelterCode();
	if (code) {
		redirect(302, resolve(`/back-office/shelters/readiness/${encodeURIComponent(code)}`));
	}
	return { code };
}) satisfies PageLoad;
