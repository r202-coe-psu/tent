import { json } from '@sveltejs/kit';
import { listDistricts } from '$lib/server/thailand-location';

export const GET = async ({ url }) => {
	const province = url.searchParams.get('province');
	if (!province) {
		return json({ error: 'province query param is required' }, { status: 400 });
	}
	try {
		return json(listDistricts(province));
	} catch {
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
