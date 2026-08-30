import type { PageLoad } from './$types';
import { fetchShelterTypes } from '$lib/features/public-portal';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const [res, shelterTypes] = await Promise.all([
			fetch(`/api/public/v1/shelters/${params.id}`),
			fetchShelterTypes(fetch)
		]);

		if (res.ok) {
			const data = await res.json().catch(() => null);
			const shelter = data?.shelter ?? null;
			if (shelter && shelter.admin_type) {
				const typeMap = new Map<string, string>();
				for (const t of shelterTypes) {
					typeMap.set(t.code, t.label);
				}
				shelter.admin_type = typeMap.get(shelter.admin_type) || shelter.admin_type;
			}
			return { shelter };
		}
	} catch (e) {
		console.warn('Failed to load shelter detail:', e);
	}

	return {
		shelter: null
	};
};
