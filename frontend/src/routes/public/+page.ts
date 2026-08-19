import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Legacy `/public` → citizen home at `/`. */
export const load = (() => {
	redirect(301, resolve('/'));
}) satisfies PageLoad;
