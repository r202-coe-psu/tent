import type { PageLoad } from './$types';

export const load: PageLoad = async ({ url, fetch }) => {
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const district = url.searchParams.get('district') || '';
	const subdistrict = url.searchParams.get('subdistrict') || '';
	const status = url.searchParams.getAll('status').join(',') || '';
	const type = url.searchParams.get('type') || '';

	let distance = url.searchParams.get('distance');
	if (distance === null) {
		distance = '5'; // Default to 5 km if not explicitly set
	}
	const user_lat = url.searchParams.get('user_lat') || '';
	const user_lng = url.searchParams.get('user_lng') || '';
	const hide_full = url.searchParams.get('hide_full') || '';

	const advancedFilterKeys = [
		'vulnerable_bed',
		'vulnerable_wheelchair',
		'vulnerable_infant',
		'vulnerable_elderly',
		'vulnerable_isolation',
		'facility_kitchen',
		'facility_women_child',
		'pet_general',
		'pet_large',
		'pet_livestock',
		'parking_car',
		'parking_motorcycle',
		'parking_boat',
		'utility_wifi',
		'utility_high_ground',
		'utility_truck_access'
	];

	const params = new URLSearchParams({
		q: search,
		province,
		district,
		subdistrict,
		type,
		status,
		distance,
		user_lat,
		user_lng,
		hide_full
	});

	for (const key of advancedFilterKeys) {
		const val = url.searchParams.get(key);
		if (val) {
			params.append(key, val);
		}
	}

	const response = await fetch(`/api/public/v1/transparency/shelters?${params.toString()}`);
	const data = await response.json();

	return data;
};
