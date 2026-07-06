import { json } from '@sveltejs/kit';
import { listProvinces } from '$lib/server/thailand-location';

export const GET = async () => {
	try {
		return json(listProvinces());
	} catch (e) {
		console.error('Failed to list provinces:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
