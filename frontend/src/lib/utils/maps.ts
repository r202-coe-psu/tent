export type MapPoint = { lat: number; lng: number };

/** Google Maps turn-by-turn directions to a point; origin is the viewer's own location. */
export function directionsUrl(geo: MapPoint): string {
	return `https://www.google.com/maps/dir/?api=1&destination=${geo.lat},${geo.lng}`;
}
