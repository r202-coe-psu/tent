/** Great-circle distance between two points, in km (haversine; earth radius 6371 km). */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

type Located = {
	geo?: { lat: number | null; lng: number | null } | null;
	distance?: number;
};

const distanceOrFar = (s: Located) =>
	s.geo ? (s.distance ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;

/** Closest first; a shelter without a pin goes last. Returns a new array. */
export function sortByDistance<T extends Located>(shelters: readonly T[]): T[] {
	return [...shelters].sort((a, b) => distanceOrFar(a) - distanceOrFar(b));
}

/**
 * The list as the search origin sees it: with an origin (GPS or a map pin, held as the strings the
 * filter panel binds to) every pinned shelter gets its distance from it, to 0.1 km, and the list is
 * ordered closest first. Without one — or when the origin is not a number — the list comes back as
 * it was given (as a new array), so `load`'s own distances stand.
 */
export function rankByUserOrigin<T extends Located>(
	shelters: readonly T[],
	userLat: string,
	userLng: string
): T[] {
	if (!(userLat && userLng)) return [...shelters];

	const originLat = parseFloat(userLat);
	const originLng = parseFloat(userLng);
	const measured = Number.isNaN(originLat) || Number.isNaN(originLng);

	const withDistance = shelters.map((s) => {
		if (measured || s?.geo?.lat == null || s?.geo?.lng == null) return s;
		const km = haversineKm(originLat, originLng, s.geo.lat, s.geo.lng);
		return { ...s, distance: parseFloat(km.toFixed(1)) };
	});
	return sortByDistance(withDistance);
}
