import type { PageLoad } from './$types';

export const load: PageLoad = async ({ fetch, params }) => {
	const res = await fetch(`/api/public/v1/transparency/shelters/${params.id}`);
	if (res.ok) {
		const data = await res.json();
		return data;
	}
	
	return {
		shelter: null
	};
};
