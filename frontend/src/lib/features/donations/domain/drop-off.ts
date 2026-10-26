/**
 * Where a donor takes (or ships) the goods. Every surface that answers "ส่งของที่ไหน"
 * reads this one shape, so adding per-point drop-off locations later only changes
 * `resolveDropOffPoint`, not its callers.
 */
import { directionsUrl } from '$lib/utils/maps';

export type DropOffGeo = { lat: number; lng: number };

/** The slice of a public shelter detail a drop-off point is built from. */
export type DropOffShelterSource = {
	id?: string;
	code?: string;
	name: string;
	address?: string | null;
	geo?: DropOffGeo | null;
};

export type DropOffPoint = {
	shelterCode: string;
	shelterName: string;
	/** `null` is the main point: the shelter's own location. */
	pointId: string | null;
	/** Point name, or the shelter name for the main point. */
	name: string;
	address: string | null;
	/** Point-level instruction (e.g. "gate 2"). Always `null` until points exist. */
	note: string | null;
	geo: DropOffGeo | null;
};

function cleanText(value: string | null | undefined): string | null {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
}

function cleanGeo(geo: DropOffGeo | null | undefined): DropOffGeo | null {
	if (!geo) return null;
	return Number.isFinite(geo.lat) && Number.isFinite(geo.lng)
		? { lat: geo.lat, lng: geo.lng }
		: null;
}

/**
 * Shelters have no drop-off points yet, so every `pointId` resolves to the main point.
 * An unknown id must keep doing that: a donor holding an old booking still needs to
 * be told where to go.
 */
export function resolveDropOffPoint(
	shelter: DropOffShelterSource,
	// eslint-disable-next-line @typescript-eslint/no-unused-vars -- reserved for per-point lookup
	_pointId: string | null = null
): DropOffPoint {
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
