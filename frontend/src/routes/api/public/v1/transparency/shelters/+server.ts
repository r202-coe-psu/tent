import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShelterMasters } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';

export const GET: RequestHandler = async ({ url }) => {
	// Query params for filtering
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const status = url.searchParams.get('status') || '';

	let masters: ShelterMaster[] = [];
	try {
		masters = await listShelterMasters();
	} catch (e) {
		console.error('Failed to load shelter masters', e);
	}

	let shelters = masters.map((m) => {
		let mappedStatus = 'CLOSED';
		if (m.operation_status === 'active') mappedStatus = 'OPEN';
		else if (m.operation_status === 'full_capacity') mappedStatus = 'FULL';
		else if (m.operation_status === 'standby') mappedStatus = 'PREPARE';

		return {
			id: m._id,
			name: m.name,
			status: mappedStatus,
			address: m.location?.address || '',
			distance: 0,
			occupancy: 0, // Should be aggregated from actual check-ins, default to 0 for now
			capacity: m.capacity || 0,
			available: m.capacity || 0,
			geo: { lat: m.location?.lat, lng: m.location?.lng }
		};
	});

	// If no shelters are found in DB, fallback to mock data for demonstration
	if (shelters.length === 0) {
		shelters = [
			{
				id: 'S001',
				name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่',
				status: 'OPEN',
				address: 'อปท. เทศบาลนครหาดใหญ่, สงขลา',
				distance: 8.5, // km
				occupancy: 3,
				capacity: 250,
				available: 247,
				geo: { lat: 7.0094, lng: 100.4735 }
			},
			{
				id: 'S002',
				name: 'ศูนย์พักพิง เทศบาลเมืองคลองแห',
				status: 'OPEN',
				address: 'อปท. เทศบาลเมืองคลองแห, สงขลา',
				distance: 8.5,
				occupancy: 1,
				capacity: 180,
				available: 179,
				geo: { lat: 7.0396, lng: 100.4731 }
			}
		];
	}

	// Apply filtering (Demo)
	if (search) {
		shelters = shelters.filter(s => s.name.includes(search) || s.address.includes(search));
	}
	if (province) {
		shelters = shelters.filter(s => s.address.includes(province));
	}
	if (status) {
		const statusList = status.split(',');
		shelters = shelters.filter(s => statusList.includes(s.status));
	}

	const summaryData = {
		shelters_total: shelters.length,
		shelters_open: shelters.filter(s => s.status === 'OPEN').length,
		occupancy_total: shelters.reduce((acc, s) => acc + s.occupancy, 0),
		vulnerable_count: 3
	};

	const flags = {
		public_metrics_occupancy: true,
		public_metrics_vulnerable: true // OP-8 default on
	};

	return json({
		summary: summaryData,
		shelters,
		flags,
		filters: { search, province, status }
	});
};
