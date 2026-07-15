import { json } from '@sveltejs/kit';
import { listProvinces } from '$lib/server/thailand-location';

export const GET = async () => {
	try {
		return json(await listProvinces());
	} catch {
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
