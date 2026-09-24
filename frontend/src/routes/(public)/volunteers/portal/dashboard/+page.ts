import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (() => {
	redirect(308, '/volunteers/portal');
}) satisfies PageLoad;
