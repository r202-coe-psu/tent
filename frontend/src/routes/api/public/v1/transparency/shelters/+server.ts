import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShelterMasters } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';
import { adminRaw } from '$lib/server/couch-admin';

export const GET: RequestHandler = async ({ url }) => {
	// Query params for filtering
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const district = url.searchParams.get('district') || '';
	const sub_district = url.searchParams.get('subdistrict') || '';
	const status = url.searchParams.get('status') || '';
	const type = url.searchParams.get('type') || '';
	const maxDistance = parseFloat(url.searchParams.get('distance') || '0');
	const userLat = parseFloat(url.searchParams.get('user_lat') || '0');
	const userLng = parseFloat(url.searchParams.get('user_lng') || '0');
	const hideFull = url.searchParams.get('hide_full') === 'true';

	// Advanced Filters
	const advancedFilters = {
		vulnerable_bed: url.searchParams.get('vulnerable_bed') === 'on',
		vulnerable_wheelchair: url.searchParams.get('vulnerable_wheelchair') === 'on',
		vulnerable_infant: url.searchParams.get('vulnerable_infant') === 'on',
		vulnerable_isolation: url.searchParams.get('vulnerable_isolation') === 'on',
		pet_general: url.searchParams.get('pet_general') === 'on',
		pet_large: url.searchParams.get('pet_large') === 'on',
		pet_livestock: url.searchParams.get('pet_livestock') === 'on',
		parking_car: url.searchParams.get('parking_car') === 'on',
		parking_motorcycle: url.searchParams.get('parking_motorcycle') === 'on',
		parking_boat: url.searchParams.get('parking_boat') === 'on',
		utility_wifi: url.searchParams.get('utility_wifi') === 'on',
		utility_high_ground: url.searchParams.get('utility_high_ground') === 'on',
		utility_truck_access: url.searchParams.get('utility_truck_access') === 'on'
	};

	let masters: ShelterMaster[] = [];
	try {
		masters = await listShelterMasters();
	} catch (e) {
		console.error('Failed to load shelter masters', e);
	}

	function calcDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
		const R = 6371; // km
		const dLat = ((lat2 - lat1) * Math.PI) / 180;
		const dLon = ((lon2 - lon1) * Math.PI) / 180;
		const a =
			Math.sin(dLat / 2) * Math.sin(dLat / 2) +
			Math.cos((lat1 * Math.PI) / 180) *
				Math.cos((lat2 * Math.PI) / 180) *
				Math.sin(dLon / 2) *
				Math.sin(dLon / 2);
		const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
		return R * c;
	}

	let shelters = await Promise.all(
		masters.map(async (m) => {
			let mappedStatus = 'CLOSED';
			if (m.operation_status === 'active') mappedStatus = 'OPEN';
			else if (m.operation_status === 'full_capacity') mappedStatus = 'FULL';
			else if (m.operation_status === 'standby') mappedStatus = 'PREPARE';

			let dist = 0;
			if (userLat && userLng && m.location?.lat && m.location?.lng) {
				dist = calcDistance(userLat, userLng, m.location.lat, m.location.lng);
			}

			let occupancy = 0;
			if (mappedStatus === 'OPEN' || mappedStatus === 'FULL') {
				try {
					const res = await adminRaw(
						`/shelter_${m.code}/_design/app/_view/occupancy?group=true`,
						'GET'
					);
					if (res.status === 200 && res.data && (res.data as Record<string, unknown>).rows) {
						const rows = (res.data as Record<string, unknown>).rows as Array<{
							key: string;
							value: unknown;
						}>;
						const checkedInRow = rows.find((r) => r.key === 'checked_in');
						if (checkedInRow) {
							occupancy = checkedInRow.value as number;
						}
					}
				} catch (err) {
					console.error(`Failed to fetch occupancy for shelter_${m.code}`, err);
				}
			}

			const capacity = m.capacity || 0;
			const available = Math.max(0, capacity - occupancy);

			return {
				id: m._id,
				name: m.name,
				status: mappedStatus,
				address: m.location?.address || '',
				distance: dist ? parseFloat(dist.toFixed(1)) : 0,
				occupancy,
				capacity,
				available,
				geo: { lat: m.location?.lat, lng: m.location?.lng },
				// assuming 'type' is part of admin_type or we use a default
				type: (m as unknown as Record<string, unknown>).admin_type || 'ศูนย์บริหารส่วนท้องถิ่น',
				// Advanced capabilities mapping
				capabilities: {
					vulnerable_bed: m.zones?.some((z) => z.type === 'vulnerable') ?? false,
					vulnerable_wheelchair: (m.facilities?.toilets_accessible ?? 0) > 0,
					vulnerable_infant: m.zones?.some((z) => z.type === 'vulnerable') ?? false,
					vulnerable_isolation: m.zones?.some((z) => z.type === 'quarantine') ?? false,
					pet_general: m.zones?.some((z) => z.type === 'pet') ?? false,
					pet_large: m.zones?.some((z) => z.type === 'pet') ?? false,
					pet_livestock: false,
					parking_car: (m.common_areas?.parking_capacity ?? 0) > 0,
					parking_motorcycle: (m.common_areas?.parking_capacity ?? 0) > 0,
					parking_boat: false,
					utility_wifi: m.utilities?.communications?.includes('wifi') ?? false,
					utility_high_ground: (m.risk?.elevation_m ?? 0) > 5,
					utility_truck_access: m.risk?.entrance_description != null
				}
			};
		})
	);

	if (search) {
		shelters = shelters.filter((s) => s.name.includes(search) || s.address.includes(search));
	}
	if (province) {
		shelters = shelters.filter((s) => s.address.includes(province));
	}
	if (district) {
		shelters = shelters.filter((s) => s.address.includes(district));
	}
	if (sub_district) {
		shelters = shelters.filter((s) => s.address.includes(sub_district));
	}
	if (type) {
		shelters = shelters.filter((s) => s.type === type);
	}
	if (status) {
		const statusList = status.split(',');
		shelters = shelters.filter((s) => statusList.includes(s.status));
	}
	if (maxDistance > 0) {
		shelters = shelters.filter((s) => s.distance > 0 && s.distance <= maxDistance);
	}
	if (hideFull) {
		shelters = shelters.filter((s) => s.available > 0);
	}

	// Apply advanced filters
	shelters = shelters.filter((s) => {
		for (const [key, isRequired] of Object.entries(advancedFilters)) {
			if (isRequired && !s.capabilities[key as keyof typeof s.capabilities]) {
				return false;
			}
		}
		return true;
	});

	const summaryData = {
		shelters_total: shelters.length,
		shelters_open: shelters.filter((s) => s.status === 'OPEN').length,
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
		filters: {
			search,
			province,
			status,
			user_lat: userLat,
			user_lng: userLng,
			hide_full: hideFull ? 'true' : '',
			...advancedFilters
		}
	});
};
