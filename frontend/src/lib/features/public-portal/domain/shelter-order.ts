/**
 * Order of the public `/shelters` result list, and the area it falls back to without a position
 * (CR-261 decision sync 2026-11-24).
 */

/** Without a position (no GPS, no map pin) the search lists only this area, to keep the load small. */
export const DEFAULT_PUBLIC_AREA = { province: 'สงขลา', district: 'หาดใหญ่' } as const;

type GeoLike = { lat: number | null; lng: number | null } | null | undefined;

export type SearchOrigin = { lat: number; lng: number };

/** Great-circle distance in km. */
export function haversineKm(a: SearchOrigin, b: SearchOrigin): number {
	const R = 6371;
	const rad = (deg: number) => (deg * Math.PI) / 180;
	const dLat = rad(b.lat - a.lat);
	const dLng = rad(b.lng - a.lng);
	const h =
		Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
	return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Distance from `origin` to one decimal, or `null` when either end has no position. */
export function distanceKm(origin: SearchOrigin | null, geo: GeoLike): number | null {
	if (!origin || geo?.lat == null || geo?.lng == null) return null;
	return parseFloat(haversineKm(origin, { lat: geo.lat, lng: geo.lng }).toFixed(1));
}

/**
 * Centres run in this system first, then external ones. Within each group, closest first when
 * there is an origin (shelters without a pin last); otherwise the API order (by name) stays.
 * Stable: equal entries keep the order they came in.
 */
export function orderShelters<T extends { is_external?: boolean | null; geo?: GeoLike }>(
	shelters: readonly T[],
	origin: SearchOrigin | null
): T[] {
	const rank = (s: T) => {
		const d = distanceKm(origin, s.geo);
		return { external: s.is_external ? 1 : 0, distance: d ?? Number.POSITIVE_INFINITY };
	};
	return shelters
		.map((shelter, index) => ({ shelter, index, ...rank(shelter) }))
		.sort(
			(a, b) =>
				a.external - b.external || (origin ? a.distance - b.distance : 0) || a.index - b.index
		)
		.map((entry) => entry.shelter);
}
