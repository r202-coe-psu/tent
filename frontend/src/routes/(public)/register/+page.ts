import type { PageLoad } from './$types';
import { listPublicShelters, toPublicShelterCard } from '$lib/features/public-portal';

/**
 * Shelter list for booking step 1, plus an optional `?shelter=CODE` deep link
 * from a shelter detail page (which locks step 1 and skips straight to the form).
 */
export const load: PageLoad = async ({ url, fetch }) => {
	const preselected = (url.searchParams.get('shelter') || '').trim().toUpperCase();

	let raw: unknown[] = [];
	try {
		const data = await listPublicShelters({ fetch });
		raw = Array.isArray(data?.shelters) ? data.shelters : [];
	} catch (e) {
		console.warn('Failed to load shelters for booking:', e);
	}

	const shelters = raw.map((item) => toPublicShelterCard(item as never));

	return {
		shelters,
		// Only honour the deep link when the shelter is real and still bookable —
		// otherwise fall through to the picker rather than locking a dead choice.
		preselected: shelters.some((s) => s.code === preselected && s.status !== 'CLOSED')
			? preselected
			: ''
	};
};
