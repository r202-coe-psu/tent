import type { LayoutLoad } from './$types';
import type { Announcement } from '$lib/features/announcements';

export const load = (async ({ fetch }) => {
	let announcements: Announcement[] = [];
	try {
		const res = await fetch('/api/public/v1/announcements');
		if (res.ok) {
			const data = await res.json();
			announcements = (data.items as Announcement[]) || [];
		}
	} catch (e) {
		console.error('Failed to fetch announcements in layout', e);
	}
	return {
		announcements
	};
}) satisfies LayoutLoad;
