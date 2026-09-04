import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/**
 * The route CR-092 §5 names for the volunteer dashboard.
 *
 * The one implementation lives at `/volunteers/portal`. This used to be a second,
 * mock-data copy of the same screen behind the staff auth wall — which volunteers have
 * no account for.
 */
export const load = (() => {
	redirect(308, resolve('/volunteers/portal'));
}) satisfies PageLoad;
