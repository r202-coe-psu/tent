import { requireKitchen } from '$lib/guards/auth';
import { redirect } from '@sveltejs/kit';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireKitchen(fetch);
	throw redirect(307, '/back-office/catalog?tab=item_master&category=item_category%3Afuel_energy');
}) satisfies PageLoad;
