import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

export const load = (() => {
	redirect(302, resolve('/public'));
}) satisfies PageLoad;
