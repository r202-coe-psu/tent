export const KIOSK_CONFIG_TIMEOUT_MS = 3_000;
/** How long a successful config fetch is reused before the kiosk home screen re-fetches — avoids
 * blocking every return-to-home on a round trip, while still picking up an admin toggle promptly. */
export const KIOSK_CONFIG_CACHE_TTL_MS = 30_000;

export type KioskConfig = { phoneCheckInEnabled: boolean; walkInRegistrationEnabled: boolean };

let cachedConfig: { config: KioskConfig; fetchedAt: number } | null = null;

/** Test-only: clears the in-memory cache so each test starts from a clean slate. */
export function resetKioskConfigCache(): void {
	cachedConfig = null;
}

/** Fail closed: any error, timeout or non-2xx response keeps the phone method hidden (FR-KPT-21).
 * A successful result is cached briefly (KIOSK_CONFIG_CACHE_TTL_MS); failures are never cached so
 * a recovered network is reflected on the very next visit, not after a stale window. */
export async function fetchKioskConfig(fetchFn: typeof fetch = fetch): Promise<KioskConfig> {
	if (cachedConfig && Date.now() - cachedConfig.fetchedAt < KIOSK_CONFIG_CACHE_TTL_MS) {
		return cachedConfig.config;
	}
	try {
		const response = await fetchFn('/api/v1/scanner/kiosk/config', {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(KIOSK_CONFIG_TIMEOUT_MS)
		});
		if (!response.ok) return { phoneCheckInEnabled: false, walkInRegistrationEnabled: false };
		const body = (await response.json()) as {
			phone_check_in_enabled?: unknown;
			walk_in_registration_enabled?: unknown;
		};
		const config: KioskConfig = {
			phoneCheckInEnabled: body.phone_check_in_enabled === true,
			walkInRegistrationEnabled: body.walk_in_registration_enabled === true
		};
		cachedConfig = { config, fetchedAt: Date.now() };
		return config;
	} catch {
		return { phoneCheckInEnabled: false, walkInRegistrationEnabled: false };
	}
}
