import type { LanguageCode } from '$lib/utils/language';

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

const FALLBACK_DISPLAY_CONTEXT: Record<LanguageCode, KioskDisplayContext> = {
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
	language: LanguageCode = 'th'
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
 * Preserve allowlisted display context when moving between kiosk routes. Takes the raw query, not
 * a `KioskDisplayContext`: fallback names stay out of the URL so the next screen can still word
 * them in the language the person picked. Secrets, session identifiers, and unknown query
 * parameters never cross this boundary.
 */
export function buildKioskContextQuery(query: KioskDisplayQuery): KioskContextQuery {
	const params = new URLSearchParams();
	for (const key of KIOSK_DISPLAY_QUERY_KEYS) {
		const value = clean(query[key]);
		if (value) params.set(key, value);
	}
	const search = params.toString();
	return search ? `?${search}` : '';
}

/** Read only allowlisted kiosk context keys from a URL. */
export function readKioskDisplayQuery(params: URLSearchParams): KioskDisplayQuery {
	const query: KioskDisplayQuery = {};
	for (const key of KIOSK_DISPLAY_QUERY_KEYS) {
		query[key] = params.get(key);
	}
	return query;
}
