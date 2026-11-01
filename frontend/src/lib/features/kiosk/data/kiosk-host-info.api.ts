import type { KioskHostInfo } from '../domain/device-info';

export const KIOSK_HOST_INFO_PATH = '/api/v1/kiosk/host-info';
export const KIOSK_HOST_INFO_TIMEOUT_MS = 3_000;

const emptyHostInfo = (): KioskHostInfo => ({ hostname: null, ips: [] });

/**
 * Hostname and LAN addresses, answered by the scanner client on the kiosk itself. Without one
 * (plain browser, any error) the device-info panel simply shows nothing for them.
 */
export async function fetchKioskHostInfo(fetchFn: typeof fetch = fetch): Promise<KioskHostInfo> {
	try {
		const response = await fetchFn(KIOSK_HOST_INFO_PATH, {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(KIOSK_HOST_INFO_TIMEOUT_MS)
		});
		if (!response.ok) return emptyHostInfo();
		const body = (await response.json()) as { hostname?: unknown; ips?: unknown } | null;
		const hostname = typeof body?.hostname === 'string' ? body.hostname.trim() : '';
		return {
			hostname: hostname || null,
			ips: Array.isArray(body?.ips)
				? body.ips.filter((ip): ip is string => typeof ip === 'string')
				: []
		};
	} catch {
		return emptyHostInfo();
	}
}
