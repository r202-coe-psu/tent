import { json } from '@sveltejs/kit';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';

export const GET = async () => {
	try {
		const masters = await listShelterMasters();
		
		// For public APIs, we filter out sensitive info and only return operational shelters
		const visible = masters
			.map(m => migrate(m as ShelterMaster))
			.filter(m => m.operation_status !== 'closed');
		
		return json(
			visible.map((m) => ({
				code: m.code,
				name: m.name
			}))
		);
	} catch (e) {
		console.error(e);
		return json({ error: 'Failed to fetch shelters' }, { status: 500 });
	}
};
