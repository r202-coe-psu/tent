import { json } from '@sveltejs/kit';
import { listAllLocations } from '$lib/server/thailand-location';

export const GET = async () => {
	try {
		return json(await listAllLocations());
	} catch {
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
