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
	wantedParkingTypes,
	DEFAULT_PUBLIC_AREA,
	distanceKm,
	orderShelters
} from '$lib/features/public-portal';
import { formatMasterLabel } from '$lib/features/master-data';

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
	const origin = hasUser ? { lat: userLatNum, lng: userLngNum } : null;
	// No position and no area or text of the visitor's own: list only the default area, so the
	// first load stays small (CR-261 decision sync 2026-11-24). Their own pick always wins.
	const defaultArea = !hasUser && !province && !district && !subdistrict && !search.trim();

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
			province: (defaultArea ? DEFAULT_PUBLIC_AREA.province : province) || undefined,
			district: (defaultArea ? DEFAULT_PUBLIC_AREA.district : district) || undefined,
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

	const cards = rawShelters.map((item) => {
		const dist = distanceKm(origin, item?.geo) ?? 0;
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

	// Centres in this system first, then closest-first when there is a search origin.
	const shelters = orderShelters(cards, origin);

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
		default_area: defaultArea,
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
			// The raw group flags; `shelterGroupChoice` reads them (an old `hide_external` is the default).
			hide_evacuation: url.searchParams.get('hide_evacuation') === 'on' ? 'on' : '',
			show_external: url.searchParams.get('show_external') === 'on' ? 'on' : ''
		},
		available_types
	};
};
