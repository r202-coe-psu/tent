import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Moved to back-office so shelter managers can manage their own devices. */
export const load = (() => {
	redirect(302, resolve('/back-office/scanners'));
}) satisfies PageLoad;
