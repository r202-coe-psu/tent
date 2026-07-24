import type { PageLoad } from './$types';
import { listPublicShelters, toPublicShelterCard } from '$lib/features/public-portal';

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
	const R = 6371;
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

export const load: PageLoad = async ({ url }) => {
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const district = url.searchParams.get('district') || '';
	const subdistrict = url.searchParams.get('subdistrict') || '';
	const statusParam = url.searchParams.getAll('status').join(',') || '';
	const distance = url.searchParams.get('distance') ?? '5';
	const user_lat = url.searchParams.get('user_lat') || '';
	const user_lng = url.searchParams.get('user_lng') || '';

	// FastAPI accepts a single status; map common UI values to Mongo status.
	const status =
		statusParam
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.find((s) => s === 'open' || s === 'closed' || s === 'full' || s === 'prepare') || '';

	const data = await listPublicShelters({
		province: province || undefined,
		district: district || undefined,
		subdistrict: subdistrict || undefined,
		status: status || undefined
	});

	const userLatNum = user_lat ? parseFloat(user_lat) : NaN;
	const userLngNum = user_lng ? parseFloat(user_lng) : NaN;
	const hasUser = !Number.isNaN(userLatNum) && !Number.isNaN(userLngNum);
	const maxDistance = distance ? parseFloat(distance) : NaN;

	let shelters = data.shelters.map((item) => {
		let dist = 0;
		if (hasUser && item.geo) {
			dist = parseFloat(haversineKm(userLatNum, userLngNum, item.geo.lat, item.geo.lng).toFixed(1));
		}
		return toPublicShelterCard(item, dist);
	});

	if (search.trim()) {
		const q = search.trim().toLowerCase();
		shelters = shelters.filter(
			(s) =>
				s.name.toLowerCase().includes(q) ||
				s.code.toLowerCase().includes(q) ||
				s.province.toLowerCase().includes(q) ||
				s.district.toLowerCase().includes(q)
		);
	}

	if (hasUser && !Number.isNaN(maxDistance) && maxDistance > 0) {
		shelters = shelters.filter((s) => !s.geo || s.distance <= maxDistance);
	}

	const openCount = shelters.filter((s) => s.status === 'OPEN').length;

	return {
		shelters,
		count: shelters.length,
		as_of: data.as_of,
		summary: {
			shelters_total: shelters.length,
			shelters_open: openCount
		},
		filters: {
			search,
			province,
			district,
			subdistrict,
			status: statusParam,
			distance,
			user_lat,
			user_lng
		},
		available_types: [] as string[]
	};
};
