import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters/server';
import { adminRaw } from '$lib/server/couch-admin';

export const GET: RequestHandler = async ({ url, setHeaders }) => {
	// Cache the response for 60 seconds on the client and CDN to mitigate N+1 query load
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});

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

	const advancedFilters = {
		vulnerable_bed: url.searchParams.get('vulnerable_bed') === 'on',
		vulnerable_wheelchair: url.searchParams.get('vulnerable_wheelchair') === 'on',
		vulnerable_infant: url.searchParams.get('vulnerable_infant') === 'on',
		vulnerable_elderly: url.searchParams.get('vulnerable_elderly') === 'on',
		vulnerable_isolation: url.searchParams.get('vulnerable_isolation') === 'on',
		facility_kitchen: url.searchParams.get('facility_kitchen') === 'on',
		facility_women_child: url.searchParams.get('facility_women_child') === 'on',
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
		masters = masters.map(migrate);
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

			const dist =
				m.location?.lat && m.location?.lng && userLat !== 0 && userLng !== 0
					? calcDistance(userLat, userLng, m.location.lat, m.location.lng)
					: null;

			let occupancy = 0;
			let vulnerableCount = 0;
			if (mappedStatus === 'OPEN' || mappedStatus === 'FULL') {
				try {
					const [occRes, ageRes] = await Promise.all([
						adminRaw(
							`/shelter_${m.code.toLowerCase()}/_design/app/_view/occupancy?group=true`,
							'GET'
						),
						adminRaw(
							`/shelter_${m.code.toLowerCase()}/_design/app/_view/demographics_by_age?group=true`,
							'GET'
						)
					]);

					if (
						occRes.status === 200 &&
						occRes.data &&
						(occRes.data as Record<string, unknown>).rows
					) {
						const rows = (occRes.data as Record<string, unknown>).rows as Array<{
							key: string;
							value: unknown;
						}>;
						const activeRow = rows.find((r) => r.key === 'active');
						if (activeRow) {
							occupancy = activeRow.value as number;
						}
					}

					if (
						ageRes.status === 200 &&
						ageRes.data &&
						(ageRes.data as Record<string, unknown>).rows
					) {
						const rows = (ageRes.data as Record<string, unknown>).rows as Array<{
							key: string;
							value: unknown;
						}>;
						for (const r of rows) {
							if (r.key === '0-4' || r.key === '60+') {
								vulnerableCount += r.value as number;
							}
						}
					}
				} catch (err) {
					console.error(`Failed to fetch stats for shelter_${m.code}`, err);
				}
			}

			const capacity = m.capacity || 0;
			const available = Math.max(0, capacity - occupancy);

			return {
				id: m._id,
				name: m.name,
				status: mappedStatus,
				address: m.location?.address || '',
				province: m.province || '',
				district: m.district || '',
				subdistrict: m.subdistrict || '',
				distance: dist !== null ? parseFloat(dist.toFixed(1)) : -1,
				occupancy,
				vulnerableCount,
				capacity,
				available,
				geo: { lat: m.location?.lat, lng: m.location?.lng },
				// assuming 'type' is part of admin_type or we use a default
				type: m.shelter_type || 'ศูนย์พักพิง/อพยพ',
				// Advanced capabilities mapping
				capabilities: {
					vulnerable_bed:
						(m.admission_policy?.supported_vulnerable_groups || []).includes('bedridden') ||
						(m.zones?.some((z) => z.type === 'vulnerable') ?? false),
					vulnerable_wheelchair:
						(m.facilities?.toilets_accessible ?? 0) > 0 ||
						(m.admission_policy?.supported_vulnerable_groups || []).includes('disabled'),
					vulnerable_infant:
						(m.admission_policy?.supported_vulnerable_groups || []).includes('infant') ||
						(m.admission_policy?.supported_vulnerable_groups || []).includes('pregnant') ||
						(m.zones?.some((z) => z.type === 'vulnerable') ?? false),
					vulnerable_elderly:
						(m.admission_policy?.supported_vulnerable_groups || []).includes('elderly') ||
						(m.zones?.some((z) => z.type === 'vulnerable') ?? false),
					vulnerable_isolation: m.zones?.some((z) => z.type === 'quarantine') ?? false,
					facility_kitchen: m.common_areas?.central_kitchen ?? false,
					facility_women_child: m.common_areas?.women_child_friendly_space ?? false,
					pet_general:
						(m.admission_policy?.pet_policy?.policy === 'conditional' &&
							(m.admission_policy.pet_policy.categories || []).some(
								(c: { category: string }) => c.category === 'small_general'
							)) ||
						(m.zones?.some((z) => z.type === 'pet') ?? false),
					pet_large:
						m.admission_policy?.pet_policy?.policy === 'conditional' &&
						(m.admission_policy.pet_policy.categories || []).some(
							(c: { category: string }) => c.category === 'large_dog'
						),
					pet_livestock:
						m.admission_policy?.pet_policy?.policy === 'conditional' &&
						(m.admission_policy.pet_policy.categories || []).some(
							(c: { category: string }) => c.category === 'livestock'
						),
					parking_car:
						(m.parking_policy?.availability === 'available' &&
							(m.parking_policy.supported_vehicles || []).some(
								(v: { type: string }) => v.type === 'car'
							)) ||
						(m.common_areas?.parking_capacity ?? 0) > 0,
					parking_motorcycle:
						(m.parking_policy?.availability === 'available' &&
							(m.parking_policy.supported_vehicles || []).some(
								(v: { type: string }) => v.type === 'motorcycle'
							)) ||
						(m.common_areas?.parking_capacity ?? 0) > 0,
					parking_boat:
						m.parking_policy?.availability === 'available' &&
						(m.parking_policy.supported_vehicles || []).some(
							(v: { type: string }) => v.type === 'boat'
						),
					utility_wifi: m.utilities?.communications?.includes('wifi') ?? false,
					utility_high_ground: (m.risk?.elevation_m ?? 0) > 5,
					utility_truck_access: m.risk?.entrance_description != null
				}
			};
		})
	);

	const summaryData = {
		shelters_total: shelters.length,
		shelters_open: shelters.filter((s) => s.status === 'OPEN').length,
		occupancy_total: shelters.reduce((acc, s) => acc + s.occupancy, 0),
		vulnerable_count: shelters.reduce((acc, s) => acc + (s.vulnerableCount || 0), 0)
	};

	if (search) {
		shelters = shelters.filter(
			(s) => s.name.includes(search) || (s.address && s.address.includes(search))
		);
	}
	if (province) {
		shelters = shelters.filter(
			(s) => s.province === province || (s.address && s.address.includes(province))
		);
	}
	if (district) {
		shelters = shelters.filter(
			(s) => s.district === district || (s.address && s.address.includes(district))
		);
	}
	if (sub_district) {
		shelters = shelters.filter(
			(s) => s.subdistrict === sub_district || (s.address && s.address.includes(sub_district))
		);
	}
	if (type) {
		shelters = shelters.filter((s) => s.type === type);
	}
	if (status) {
		const statusList = status.split(',');
		shelters = shelters.filter((s) => statusList.includes(s.status));
	}
	if (maxDistance > 0 && userLat !== 0 && userLng !== 0) {
		shelters = shelters.filter((s) => s.distance >= 0 && s.distance <= maxDistance);
	}
	if (hideFull) {
		shelters = shelters.filter((s) => s.status !== 'FULL' && (s.capacity === 0 || s.available > 0));
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

	const flags = {
		public_metrics_occupancy: true,
		public_metrics_vulnerable: true // OP-8 default on
	};

	const available_types = Array.from(
		new Set(masters.map((m) => m.shelter_type || 'ศูนย์พักพิง/อพยพ'))
	)
		.filter(Boolean)
		.sort();

	return json({
		summary: summaryData,
		shelters,
		available_types,
		flags,
		filters: {
			search,
			province,
			district,
			subdistrict: sub_district,
			type,
			status,
			distance: maxDistance > 0 ? maxDistance.toString() : '',
			user_lat: userLat,
			user_lng: userLng,
			hide_full: hideFull ? 'true' : '',
			...advancedFilters
		}
	});
};
