import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/public/v1/shelters/${params.id}`);
	if (res.ok) {
		const data = await res.json();
		return { shelter: data.shelter };
	}

	return {
		shelter: null
	};
};
