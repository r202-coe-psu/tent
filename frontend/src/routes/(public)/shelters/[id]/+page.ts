import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	try {
		const res = await fetch(`/api/public/v1/shelters/${params.id}`);
		if (res.ok) {
			const data = await res.json().catch(() => null);
			return { shelter: data?.shelter ?? null };
		}
	} catch (e) {
		console.warn('Failed to load shelter detail:', e);
	}

	return {
		shelter: null
	};
};
