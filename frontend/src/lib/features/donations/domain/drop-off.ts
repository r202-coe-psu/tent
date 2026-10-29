/**
 * Where a donor takes (or ships) the goods. Every surface that answers "ส่งของที่ไหน"
 * reads this one shape, so adding per-point drop-off locations later only changes
 * `resolveDropOffPoint`, not its callers.
 */
import { directionsUrl } from '$lib/utils/maps';

export type DropOffGeo = { lat: number; lng: number };

/** One entry of `public_shelters.donation_points` (CR-205), as `GET /public/v1/shelters/{code}` returns it. */
export type DonationPointSource = {
	id: string;
	name: string;
	types?: readonly string[];
	geo: DropOffGeo;
	location_note?: string | null;
};

/** The slice of a public shelter detail a drop-off point is built from. */
export type DropOffShelterSource = {
	id?: string;
	code?: string;
	name: string;
	address?: string | null;
	geo?: DropOffGeo | null;
	donation_points?: readonly DonationPointSource[] | null;
};

export type DropOffPoint = {
	shelterCode: string;
	shelterName: string;
	/** `null` is the main point: the shelter's own location. */
	pointId: string | null;
	/** Point name, or the shelter name for the main point. */
	name: string;
	address: string | null;
	/** Point-level instruction (e.g. "gate 2"). `null` for the main point. */
	note: string | null;
	geo: DropOffGeo | null;
};

/** FastAPI fills a missing shelter address with this placeholder instead of omitting it. */
const UNSPECIFIED = 'unspecified';

function cleanText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed && trimmed !== UNSPECIFIED ? trimmed : null;
}

/** (0,0) is what an unset location projects to, not a real shelter, so it gets no map link. */
function cleanGeo(geo: DropOffGeo | null | undefined): DropOffGeo | null {
	if (!geo) return null;
	const { lat, lng } = geo;
	const inRange =
		Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180;
	return inRange && !(lat === 0 && lng === 0) ? { lat, lng } : null;
}

/** The main point: the shelter's own location. Bookings do not pick a point yet (#813). */
export function resolveDropOffPoint(shelter: DropOffShelterSource): DropOffPoint {
	return {
		shelterCode: shelter.code ?? shelter.id ?? '',
		shelterName: shelter.name,
		pointId: null,
		name: shelter.name,
		address: cleanText(shelter.address),
		note: null,
		geo: cleanGeo(shelter.geo)
	};
}

/**
 * Every place a donor can drop off at this shelter (CR-205 FR-DP-16/17). Ticked points
 * replace the shelter's own location; with none, the main point is the only choice.
 */
export function listDropOffPoints(shelter: DropOffShelterSource): DropOffPoint[] {
	const main = resolveDropOffPoint(shelter);
	const points = shelter.donation_points ?? [];
	if (points.length === 0) return [main];
	return points.map((point) => ({
		...main,
		pointId: point.id,
		name: point.name,
		note: cleanText(point.location_note),
		geo: cleanGeo(point.geo)
	}));
}

/** `null` when the point has no coordinates: the UI then shows the address without a button. */
export function dropOffDirectionsUrl(point: Pick<DropOffPoint, 'geo'>): string | null {
	return point.geo ? directionsUrl(point.geo) : null;
}

/**
 * Only the methods where the donor or a courier travels to the shelter need a destination.
 * `shelter_pickup` sends the shelter's own vehicle to the donor's address instead.
 */
export function needsDropOffDestination(deliveryMethod: string | null | undefined): boolean {
	return deliveryMethod === 'self_dropoff' || deliveryMethod === 'parcel';
}
