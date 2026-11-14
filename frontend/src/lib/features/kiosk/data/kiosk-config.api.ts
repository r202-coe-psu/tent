export const KIOSK_CONFIG_TIMEOUT_MS = 3_000;
/** How long a successful config fetch is reused before the kiosk home screen re-fetches — avoids
 * blocking every return-to-home on a round trip, while still picking up an admin toggle promptly. */
export const KIOSK_CONFIG_CACHE_TTL_MS = 30_000;
/** How long the layout's closure gate trusts a failed read before asking again: on a flaky link every
 * navigation would otherwise wait up to KIOSK_CONFIG_TIMEOUT_MS just to end up "open" anyway. */
export const KIOSK_SERVICE_GATE_FAILURE_TTL_MS = 15_000;

export type KioskConfig = {
	phoneCheckInEnabled: boolean;
	walkInRegistrationEnabled: boolean;
	thaidCheckInEnabled: boolean;
	/** Per-device closure (#1302): `false` while an admin has closed this kiosk. */
	serviceOpen: boolean;
};

const FAIL_CLOSED_CONFIG: KioskConfig = {
	phoneCheckInEnabled: false,
	walkInRegistrationEnabled: false,
	thaidCheckInEnabled: false,
	/** An unreadable config never closes the kiosk: the server answers 403 KIOSK_CLOSED on work
	 * endpoints, so closure is enforced there, not by a failed read here. */
	serviceOpen: true
};

let cachedConfig: { config: KioskConfig; fetchedAt: number } | null = null;
let lastFailedAt: number | null = null;

/** Test-only: clears the in-memory cache so each test starts from a clean slate. */
export function resetKioskConfigCache(): void {
	cachedConfig = null;
	lastFailedAt = null;
}

/** Fail closed for the method flags: any error, timeout or non-2xx keeps them off (FR-KPT-21);
 * `serviceOpen` alone fails open (see FAIL_CLOSED_CONFIG).
 * A successful result is cached briefly (KIOSK_CONFIG_CACHE_TTL_MS); failures are never cached so
 * a recovered network is reflected on the very next visit, not after a stale window. */
export async function fetchKioskConfig(
	fetchFn: typeof fetch = fetch,
	options: { bypassCache?: boolean } = {}
): Promise<KioskConfig> {
	if (
		!options.bypassCache &&
		cachedConfig &&
		Date.now() - cachedConfig.fetchedAt < KIOSK_CONFIG_CACHE_TTL_MS
	) {
		return cachedConfig.config;
	}
	return (await requestKioskConfig(fetchFn)) ?? { ...FAIL_CLOSED_CONFIG };
}

/** What the server says about this kiosk right now: `true`/`false` only for a successful read, `null`
 * when it could not be read (non-ok, network error, timeout). Always bypasses the cache and refreshes
 * it on success. Used where "unreadable" must differ from "open" (the closed page must not reopen on
 * a network blip, the home screen must not close on one). */
export async function readKioskServiceOpen(fetchFn: typeof fetch = fetch): Promise<boolean | null> {
	const config = await requestKioskConfig(fetchFn);
	return config === null ? null : config.serviceOpen;
}

/** The layout's closure gate (FR-SBO-47), run on every kiosk navigation: `false` only when the server
 * said closed. Reuses a fresh successful read, and after a failed read answers "open" without asking
 * again for KIOSK_SERVICE_GATE_FAILURE_TTL_MS (work endpoints still answer 403 KIOSK_CLOSED). The
 * failure memo is for this gate only: `fetchKioskConfig` never caches failures. */
export async function readKioskServiceGate(fetchFn: typeof fetch = fetch): Promise<boolean> {
	const now = Date.now();
	if (cachedConfig && now - cachedConfig.fetchedAt < KIOSK_CONFIG_CACHE_TTL_MS) {
		return cachedConfig.config.serviceOpen;
	}
	if (lastFailedAt !== null && now - lastFailedAt < KIOSK_SERVICE_GATE_FAILURE_TTL_MS) return true;
	return (await requestKioskConfig(fetchFn))?.serviceOpen ?? true;
}

/** One config round trip. `null` = could not read; a successful read also refreshes the cache. */
async function requestKioskConfig(fetchFn: typeof fetch): Promise<KioskConfig | null> {
	try {
		const response = await fetchFn('/api/v1/kiosk/config', {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(KIOSK_CONFIG_TIMEOUT_MS)
		});
		if (!response.ok) return failedRead();
		const body = (await response.json()) as {
			phone_check_in_enabled?: unknown;
			walk_in_registration_enabled?: unknown;
			thaid_check_in_enabled?: unknown;
			service_open?: unknown;
		};
		const config: KioskConfig = {
			phoneCheckInEnabled: body.phone_check_in_enabled === true,
			walkInRegistrationEnabled: body.walk_in_registration_enabled === true,
			thaidCheckInEnabled: body.thaid_check_in_enabled === true,
			serviceOpen: body.service_open !== false
		};
		cachedConfig = { config, fetchedAt: Date.now() };
		lastFailedAt = null;
		return config;
	} catch {
		return failedRead();
	}
}

function failedRead(): null {
	lastFailedAt = Date.now();
	return null;
}
