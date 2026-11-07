export const KIOSK_DISPLAY_QUERY_KEYS = [
	'shelter_name',
	'shelter_code',
	'station_name',
	'device_name'
] as const;

export type KioskDisplayQueryKey = (typeof KIOSK_DISPLAY_QUERY_KEYS)[number];

export interface KioskDisplayQuery {
	shelter_name?: string | null;
	shelter_code?: string | null;
	station_name?: string | null;
	device_name?: string | null;
}

export interface KioskDisplayContext {
	shelterName: string;
	shelterCode: string;
	stationName: string;
	deviceName: string;
}

const FALLBACK_DISPLAY_CONTEXT: Record<'th' | 'en', KioskDisplayContext> = {
	th: {
		shelterName: 'ศูนย์พักพิง',
		shelterCode: '',
		stationName: 'จุดคัดกรองทั่วไป',
		deviceName: 'Kiosk'
	},
	en: {
		shelterName: 'Shelter',
		shelterCode: '',
		stationName: 'General screening point',
		deviceName: 'Kiosk'
	}
};

function clean(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

/** `language` only picks the wording of the fallbacks; names that came in the query stay as given. */
export function getKioskDisplayContext(
	query: KioskDisplayQuery,
	language: 'th' | 'en' = 'th'
): KioskDisplayContext {
	const fallback = FALLBACK_DISPLAY_CONTEXT[language];
	return {
		shelterName: clean(query.shelter_name) || fallback.shelterName,
		shelterCode: clean(query.shelter_code),
		stationName: clean(query.station_name) || fallback.stationName,
		deviceName: clean(query.device_name) || fallback.deviceName
	};
}

/**
 * Query string carrying the kiosk display context between routes: `?…`, or `''` for none. Typed
 * this way so passing `/kiosk${contextQuery}` to `resolve()` type-checks without a cast.
 */
export type KioskContextQuery = '' | `?${string}`;

/**
 * Preserve allowlisted display context when moving between kiosk routes.
 * Secrets, session identifiers, and unknown query parameters never cross this boundary.
 */
export function buildKioskContextQuery(context: KioskDisplayContext): KioskContextQuery {
	const params = new URLSearchParams();

	params.set('shelter_name', context.shelterName);
	if (context.shelterCode) params.set('shelter_code', context.shelterCode);
	params.set('station_name', context.stationName);
	params.set('device_name', context.deviceName);

	return `?${params.toString()}`;
}

/** Read only allowlisted kiosk context keys from a URL. */
export function readKioskDisplayQuery(params: URLSearchParams): KioskDisplayQuery {
	const query: KioskDisplayQuery = {};
	for (const key of KIOSK_DISPLAY_QUERY_KEYS) {
		query[key] = params.get(key);
	}
	return query;
}
