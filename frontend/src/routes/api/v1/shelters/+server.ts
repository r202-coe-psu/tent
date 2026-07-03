import { json } from '@sveltejs/kit';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';

export const GET = async () => {
	try {
		const masters = await listShelterMasters();

		const visible = masters
			.map((m) => migrate(m as ShelterMaster))
			.filter((m) => m.operation_status !== 'closed');

		return json(
			visible.map((m) => ({
				code: m.code,
				name: m.name,
				status: m.operation_status,
				capacity: m.capacity ?? 0
			}))
		);
	} catch (e) {
		console.error('Failed to list shelters:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
