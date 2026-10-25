import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import type { PageLoad } from './$types';

/** Screen pages moved under a banner group; old bookmarks land on the group list. */
export const load = (() => {
	redirect(302, resolve('/back-office/kiosks/banners'));
}) satisfies PageLoad;
