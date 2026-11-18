import type { PageLoad } from './$types';
import {
	fetchShelterSummary,
	fetchShelterTypes,
	listPublicShelters,
	toPublicShelterCard,
	type PublicShelterListResponse,
	type PublicShelterItem,
	type PublicShelterSummary,
	type MasterLabelOption,
	hiddenShelterGroups,
	wantedParkingTypes
} from '$lib/features/public-portal';
import { formatMasterLabel } from '$lib/features/master-data';

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

export const load: PageLoad = async ({ url, fetch }) => {
	const search = url.searchParams.get('q') || '';
	const province = url.searchParams.get('province') || '';
	const district = url.searchParams.get('district') || '';
	const subdistrict = url.searchParams.get('subdistrict') || '';
	const typeFilter = url.searchParams.get('type') || '';
	const statusParam = url.searchParams.getAll('status').join(',') || '';
	// 5 km unless the visitor chose otherwise; `distance=` (empty) means they cleared the radius.
	const distance = url.searchParams.get('distance') ?? '5';
	const user_lat = url.searchParams.get('user_lat') || '';
	const user_lng = url.searchParams.get('user_lng') || '';
	const hide_full = url.searchParams.get('hide_full') === 'true';
	const parkingWanted = wantedParkingTypes(url.searchParams);
	const groupsHidden = hiddenShelterGroups(url.searchParams);

	// FastAPI accepts a single Mongo status; map UI `prepare` → `standby`.
	const statusRaw =
		statusParam
			.split(',')
			.map((s) => s.trim().toLowerCase())
			.find(
				(s) =>
					s === 'open' ||
					s === 'closed' ||
					s === 'full' ||
					s === 'prepare' ||
					s === 'standby' ||
					// CR-252 FR-23: external shelters
					s === 'unknown'
			) || '';
	const status = statusRaw === 'prepare' ? 'standby' : statusRaw;

	const userLatNum = user_lat ? parseFloat(user_lat) : NaN;
	const userLngNum = user_lng ? parseFloat(user_lng) : NaN;
	const hasUser = !Number.isNaN(userLatNum) && !Number.isNaN(userLngNum);
	const maxDistance = distance ? parseFloat(distance) : NaN;
	const hasRadius = hasUser && !Number.isNaN(maxDistance) && maxDistance > 0;

	// The cards count every shelter the page can list, whatever the filters say (#1419).
	// When it cannot be had the cards say so (`null` → a dash). Zeros would read as "no shelters".
	const summaryPromise: Promise<PublicShelterSummary | null> = fetchShelterSummary({
		hide_host_house: true,
		fetch
	}).catch(() => null);

	let shelterTypes: MasterLabelOption[] = [];
	try {
		shelterTypes = await fetchShelterTypes(fetch);
	} catch {
		/* no labels: the list still loads, with the raw type codes */
	}

	const typeMap = new Map<string, string>();
	for (const t of shelterTypes) {
		typeMap.set(t.code, formatMasterLabel(t, 'th'));
	}
	// The URL and the filter panel speak labels; the database holds the type code.
	const adminTypeCode = typeFilter.trim()
		? (shelterTypes.find((t) => formatMasterLabel(t, 'th') === typeFilter.trim())?.code ??
			typeFilter.trim())
		: undefined;

	let data: PublicShelterListResponse | null;
	try {
		data = await listPublicShelters({
			province: province || undefined,
			district: district || undefined,
			subdistrict: subdistrict || undefined,
			status: status || undefined,
			// With a radius the database cuts and orders by distance (`$nearSphere`). Without one it
			// would drop every shelter that has no pin, so the position stays here and only the
			// distances and the order are worked out below.
			lat: hasRadius ? userLatNum : undefined,
			lng: hasRadius ? userLngNum : undefined,
			radius_km: hasRadius ? maxDistance : undefined,
			q: search,
			admin_type: adminTypeCode,
			hide_full,
			hide_evacuation: groupsHidden.includes('evacuation'),
			hide_external: groupsHidden.includes('external'),
			// The evacuee-facing search never lists a plain host house (#1419).
			hide_host_house: true,
			parking: parkingWanted,
			fetch
		});
	} catch {
		data = { shelters: [], count: 0, as_of: new Date().toISOString() };
	}

	const rawShelters = (Array.isArray(data?.shelters) ? data.shelters : []) as PublicShelterItem[];

	let shelters = rawShelters.map((item) => {
		let dist = 0;
		if (hasUser && item?.geo && item.geo.lat != null && item.geo.lng != null) {
			dist = parseFloat(haversineKm(userLatNum, userLngNum, item.geo.lat, item.geo.lng).toFixed(1));
		}
		const rawAdminType = item?.admin_type || (item as Record<string, unknown>)?.shelter_type;
		const resolvedAdminType =
			typeof rawAdminType === 'string'
				? typeMap.get(rawAdminType) || (rawAdminType !== 'unspecified' ? rawAdminType : null)
				: null;

		return toPublicShelterCard(
			{
				...item,
				admin_type: resolvedAdminType,
				vulnerable_groups: item?.vulnerable_groups ?? undefined
			},
			dist
		);
	});

	// Closest-first when a search origin (GPS or map pin) is present.
	if (hasUser) {
		shelters = [...shelters].sort((a, b) => {
			const da = a.geo ? (a.distance ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
			const db = b.geo ? (b.distance ?? Number.POSITIVE_INFINITY) : Number.POSITIVE_INFINITY;
			return da - db;
		});
	}

	const available_types = Array.from(
		new Set(
			shelterTypes.length > 0
				? shelterTypes.map((t) => formatMasterLabel(t, 'th'))
				: (shelters.map((s) => s.admin_type).filter(Boolean) as string[])
		)
	).filter(Boolean);

	return {
		shelters,
		count: shelters.length,
		as_of: data?.as_of ?? new Date().toISOString(),
		summary: await summaryPromise,
		filters: {
			search,
			province,
			district,
			subdistrict,
			type: typeFilter,
			status: statusParam,
			distance,
			user_lat,
			user_lng,
			hide_full: hide_full ? 'true' : '',
			parking_car: parkingWanted.includes('car') ? 'on' : '',
			parking_motorcycle: parkingWanted.includes('motorcycle') ? 'on' : '',
			parking_boat: parkingWanted.includes('boat') ? 'on' : '',
			hide_evacuation: groupsHidden.includes('evacuation') ? 'on' : '',
			hide_external: groupsHidden.includes('external') ? 'on' : ''
		},
		available_types
	};
};
