import { json } from '@sveltejs/kit';
import { listSubdistricts } from '$lib/server/thailand-location';

export const GET = async ({ url }) => {
	const province = url.searchParams.get('province');
	const district = url.searchParams.get('district');
	if (!province || !district) {
		return json({ error: 'province and district query params are required' }, { status: 400 });
	}
	try {
		return json(listSubdistricts(province, district));
	} catch (e) {
		console.error('Failed to list subdistricts:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
