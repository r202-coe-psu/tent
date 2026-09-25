export const KIOSK_DISPLAY_QUERY_KEYS = [
	'shelter_name',
	'shelter_code',
	'station_name',
	'device_name',
	'phone_check_in'
] as const;

// FR-KPT-10: keep this wire value aligned with PHONE_CHECK_IN_OFF_VALUE in scanner_client/app/config.py.
export const KIOSK_PHONE_CHECK_IN_OFF = 'off';

export type KioskDisplayQueryKey = (typeof KIOSK_DISPLAY_QUERY_KEYS)[number];

export interface KioskDisplayQuery {
	shelter_name?: string | null;
	shelter_code?: string | null;
	station_name?: string | null;
	device_name?: string | null;
	phone_check_in?: string | null;
}

export interface KioskDisplayContext {
	shelterName: string;
	shelterCode: string;
	stationName: string;
	deviceName: string;
	phoneCheckInEnabled: boolean;
}

const FALLBACK_DISPLAY_CONTEXT: KioskDisplayContext = {
	shelterName: 'ศูนย์พักพิง',
	shelterCode: '',
	stationName: 'จุดคัดกรองทั่วไป',
	deviceName: 'Kiosk',
	phoneCheckInEnabled: true
};

function clean(value: string | null | undefined): string {
	return value?.trim() ?? '';
}

export function getKioskDisplayContext(query: KioskDisplayQuery): KioskDisplayContext {
	return {
		shelterName: clean(query.shelter_name) || FALLBACK_DISPLAY_CONTEXT.shelterName,
		shelterCode: clean(query.shelter_code),
		stationName: clean(query.station_name) || FALLBACK_DISPLAY_CONTEXT.stationName,
		deviceName: clean(query.device_name) || FALLBACK_DISPLAY_CONTEXT.deviceName,
		phoneCheckInEnabled: clean(query.phone_check_in).toLowerCase() !== KIOSK_PHONE_CHECK_IN_OFF
	};
}

/**
 * Preserve allowlisted display context and feature flags when moving between kiosk routes.
 * Secrets, session identifiers, and unknown query parameters never cross this boundary.
 */
export function buildKioskContextQuery(context: KioskDisplayContext): string {
	const params = new URLSearchParams();

	params.set('shelter_name', context.shelterName);
	if (context.shelterCode) params.set('shelter_code', context.shelterCode);
	params.set('station_name', context.stationName);
	params.set('device_name', context.deviceName);
	if (!context.phoneCheckInEnabled) params.set('phone_check_in', KIOSK_PHONE_CHECK_IN_OFF);

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
