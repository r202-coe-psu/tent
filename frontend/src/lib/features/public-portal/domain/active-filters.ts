/**
 * The filters in effect on the public `/shelters` search, as removable chips (#1419).
 *
 * Input is the `filters` echo of the page load (URL values: '' = off, flags 'on'/'true').
 * Output tells the page what to show and which URL keys to drop when a chip is removed.
 */

/** The radius the page applies when the visitor has not chosen one (the load's `?? '5'`). */
export const DEFAULT_RADIUS_KM = '5';
/** Radius buttons in the filter panel, smallest first. */
export const RADIUS_PRESETS_KM = ['1', '2', '4', '5', '10'] as const;

type FilterValue = string | number | boolean | undefined | null;

export type ActiveFilterValues = {
	search?: FilterValue;
	province?: FilterValue;
	district?: FilterValue;
	subdistrict?: FilterValue;
	type?: FilterValue;
	status?: FilterValue;
	distance?: FilterValue;
	user_lat?: FilterValue;
	user_lng?: FilterValue;
	hide_full?: FilterValue;
	parking_car?: FilterValue;
	parking_motorcycle?: FilterValue;
	parking_boat?: FilterValue;
	hide_evacuation?: FilterValue;
	hide_external?: FilterValue;
};

export type ActiveFilterLabels = {
	radius: (km: string) => string;
	search: (query: string) => string;
	/** `value` is the lowercase URL status (`open`, `full`, `prepare`, `closed`, `unknown`). */
	status: (value: string) => string;
	/** `label` is the building type as the URL carries it (a label, not a code). */
	type: (label: string) => string;
	province: (name: string) => string;
	district: (name: string) => string;
	subdistrict: (name: string) => string;
	hideFull: string;
	parking: Record<'car' | 'motorcycle' | 'boat', string>;
	hiddenGroup: Record<'evacuation' | 'external', string>;
};

export type ActiveFilterChip = {
	key: string;
	label: string;
	/** URL keys this chip's filter lives in; removing the chip drops them. */
	removes: string[];
	/** Counted in the badge on the filter buttons (the default radius is not). */
	counts: boolean;
};

/** Why an empty result list is empty — picks the wording and the way out. */
export type EmptyListReason = 'radius' | 'filtered' | 'none';

function text(value: FilterValue): string {
	return value === undefined || value === null ? '' : String(value).trim();
}

function isOn(value: FilterValue): boolean {
	return value === true || value === 'on' || value === 'true';
}

/** The default radius exactly: `'5'`. A cleared radius (`''`) or any other value is not. */
export function isDefaultRadius(distance: FilterValue): boolean {
	return text(distance) === DEFAULT_RADIUS_KM;
}

/** Same rule as the page load: a position and a positive distance. */
export function isRadiusActive(filters: ActiveFilterValues): boolean {
	const lat = parseFloat(text(filters.user_lat));
	const lng = parseFloat(text(filters.user_lng));
	const km = parseFloat(text(filters.distance));
	return !Number.isNaN(lat) && !Number.isNaN(lng) && Number.isFinite(km) && km > 0;
}

/** The next preset above `current`; `''` (no radius) once past the largest. */
export function nextRadiusKm(current: FilterValue): string {
	const km = parseFloat(text(current));
	return RADIUS_PRESETS_KM.find((preset) => Number(preset) > km) ?? '';
}

export function activeFilterChips(
	filters: ActiveFilterValues,
	labels: ActiveFilterLabels
): ActiveFilterChip[] {
	const chips: ActiveFilterChip[] = [];
	const add = (key: string, label: string, removes: string[], counts = true) =>
		chips.push({ key, label, removes, counts });

	const search = text(filters.search);
	if (search) add('search', labels.search(search), ['q']);

	if (isRadiusActive(filters)) {
		const km = text(filters.distance);
		add('radius', labels.radius(km), ['distance'], !isDefaultRadius(km));
	}

	const status = text(filters.status).split(',')[0]?.trim().toLowerCase() ?? '';
	if (status) add('status', labels.status(status), ['status']);

	const type = text(filters.type);
	if (type) add('type', labels.type(type), ['type']);

	const province = text(filters.province);
	if (province) add('province', labels.province(province), ['province', 'district', 'subdistrict']);
	const district = text(filters.district);
	if (district) add('district', labels.district(district), ['district', 'subdistrict']);
	const subdistrict = text(filters.subdistrict);
	if (subdistrict) add('subdistrict', labels.subdistrict(subdistrict), ['subdistrict']);

	if (isOn(filters.hide_full)) add('hide_full', labels.hideFull, ['hide_full']);
	if (isOn(filters.parking_car)) add('parking_car', labels.parking.car, ['parking_car']);
	if (isOn(filters.parking_motorcycle))
		add('parking_motorcycle', labels.parking.motorcycle, ['parking_motorcycle']);
	if (isOn(filters.parking_boat)) add('parking_boat', labels.parking.boat, ['parking_boat']);
	if (isOn(filters.hide_evacuation))
		add('hide_evacuation', labels.hiddenGroup.evacuation, ['hide_evacuation']);
	if (isOn(filters.hide_external))
		add('hide_external', labels.hiddenGroup.external, ['hide_external']);

	return chips;
}

/** The number on the filter buttons: every chip but the default radius. */
export function activeFilterCount(chips: readonly ActiveFilterChip[]): number {
	return chips.filter((chip) => chip.counts).length;
}

export function emptyListReason(chips: readonly ActiveFilterChip[]): EmptyListReason {
	if (chips.some((chip) => chip.key !== 'radius')) return 'filtered';
	return chips.length > 0 ? 'radius' : 'none';
}

/**
 * Params with one chip's filter removed. The radius is emptied (`distance=`), never dropped:
 * a URL without `distance` means "the default 5 km", not "no radius".
 */
export function paramsWithoutFilter(
	params: URLSearchParams,
	chip: ActiveFilterChip
): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const key of chip.removes) {
		if (key === 'distance') next.set('distance', '');
		else next.delete(key);
	}
	return next;
}

/** "Clear all": every counted filter goes; the position stays and the radius is the default. */
export function paramsWithoutAllFilters(
	params: URLSearchParams,
	chips: readonly ActiveFilterChip[]
): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const chip of chips) {
		if (!chip.counts) continue;
		if (chip.key === 'radius') next.set('distance', DEFAULT_RADIUS_KM);
		else for (const key of chip.removes) next.delete(key);
	}
	return next;
}

/** Forget the search origin and the radius drawn around it. */
export function paramsWithoutPosition(params: URLSearchParams): URLSearchParams {
	const next = new URLSearchParams(params);
	for (const key of ['user_lat', 'user_lng', 'distance']) next.delete(key);
	return next;
}

/** A new radius; `''` clears it (kept as `distance=`). */
export function paramsWithRadius(params: URLSearchParams, km: string): URLSearchParams {
	const next = new URLSearchParams(params);
	next.set('distance', km);
	return next;
}

/**
 * Desktop: the chips and the empty state live in the right-hand list panel. With that panel
 * collapsed they go on the map instead, so the filters can still be switched off — always when
 * nothing was found, otherwise while a filter is on. Never both places at once.
 */
export function showMapFilterOverlay(state: {
	listPanelOpen: boolean;
	chipCount: number;
	resultCount: number;
}): boolean {
	if (state.listPanelOpen) return false;
	return state.chipCount > 0 || state.resultCount === 0;
}
