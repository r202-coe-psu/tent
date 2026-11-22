import type { KioskHostInfo } from '../domain/device-info';

export const KIOSK_HOST_INFO_PATH = '/api/v1/kiosk/host-info';
export const KIOSK_HOST_INFO_TIMEOUT_MS = 3_000;

const emptyHostInfo = (): KioskHostInfo => ({
	hostname: null,
	ips: [],
	commit: null,
	updatedAt: null,
	lastCheck: null
});

const textOrNull = (value: unknown): string | null =>
	typeof value === 'string' && value.trim() ? value.trim() : null;

function lastCheckOf(value: unknown): KioskHostInfo['lastCheck'] {
	if (typeof value !== 'object' || value === null) return null;
	const { at, outcome } = value as { at?: unknown; outcome?: unknown };
	const checkedAt = textOrNull(at);
	const said = textOrNull(outcome);
	return checkedAt && said ? { at: checkedAt, outcome: said } : null;
}

/**
 * Hostname, LAN addresses and update state (commit, last update), answered by the scanner client on the kiosk itself. Without one
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
		const body = (await response.json()) as {
			hostname?: unknown;
			ips?: unknown;
			commit?: unknown;
			updated_at?: unknown;
			last_check?: unknown;
		} | null;
		return {
			hostname: textOrNull(body?.hostname),
			ips: Array.isArray(body?.ips)
				? body.ips.filter((ip): ip is string => typeof ip === 'string')
				: [],
			commit: textOrNull(body?.commit),
			updatedAt: textOrNull(body?.updated_at),
			lastCheck: lastCheckOf(body?.last_check)
		};
	} catch {
		return emptyHostInfo();
	}
}
