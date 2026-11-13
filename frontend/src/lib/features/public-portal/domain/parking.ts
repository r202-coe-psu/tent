import type { PublicGeoPoint, PublicParkingPoint, PublicShelterCardModel } from './types';

/** `/shelters` checkbox query keys → the vehicle type each one asks for (CR-253 FR-33). */
export const PARKING_FILTER_TYPES = {
	parking_car: 'car',
	parking_motorcycle: 'motorcycle',
	parking_boat: 'boat'
} as const;

/** Types ticked in the URL (`parking_car=on` …), in a stable order. */
export function wantedParkingTypes(params: URLSearchParams): string[] {
	return Object.entries(PARKING_FILTER_TYPES)
		.filter(([key]) => params.get(key) === 'on')
		.map(([, type]) => type);
}

/** A shelter passes only when it takes every ticked type (AND); nothing ticked = no filter (FR-34). */
export function takesAllParkingTypes(shelterTypes: readonly string[], wanted: readonly string[]) {
	return wanted.every((type) => shelterTypes.includes(type));
}

/** A parking pin on the shelter search map; `shelterCode` ties it back to its shelter. */
export type ParkingMapPoint = {
	id: string;
	shelterCode: string;
	geo: PublicGeoPoint;
	name: string;
	note: string | null;
	vehicles: PublicParkingPoint['vehicles'];
};

/** Pins for every shelter in the result list (FR-30); a point without usable coordinates is skipped. */
export function toParkingMapPoints(
	shelters: Pick<PublicShelterCardModel, 'code' | 'parking_points'>[]
): ParkingMapPoint[] {
	return shelters.flatMap((shelter) =>
		(shelter.parking_points ?? [])
			.filter((p) => p.geo?.lat != null && p.geo?.lng != null)
			.filter((p) => Number.isFinite(Number(p.geo.lat)) && Number.isFinite(Number(p.geo.lng)))
			.map((p) => ({
				id: `${shelter.code}:${p.id}`,
				shelterCode: shelter.code,
				geo: p.geo,
				name: p.name,
				note: p.note ?? null,
				vehicles: p.vehicles ?? []
			}))
	);
}
