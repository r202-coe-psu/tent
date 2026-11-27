import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import { requireEvacueeRegistration } from '$lib/guards/auth';
import type { PageLoad } from './$types';

/** Tabs that moved to /back-office/overview (old bookmarks and links keep working). */
const MOVED_TABS = {
	dashboard: '/back-office/overview/evacuees',
	meals: '/back-office/overview/food'
} as const;

// Evacuee PII — restrict to system_admin + shelter_manager. Explicit here rather
// than relying on the back-office layout, which now only requireAuth so page-level
// guards like requireKitchen can run (kitchen_staff, CR-024).
export const load = (async ({ fetch, url }) => {
	await requireEvacueeRegistration(fetch);

	const tab = url.searchParams.get('tab');
	if (tab === 'dashboard' || tab === 'meals') {
		const rest = new URLSearchParams(url.searchParams);
		rest.delete('tab');
		const query = rest.toString();
		redirect(307, `${resolve(MOVED_TABS[tab])}${query ? `?${query}` : ''}`);
	}
}) satisfies PageLoad;
