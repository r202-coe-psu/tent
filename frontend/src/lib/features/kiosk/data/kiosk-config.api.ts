export const KIOSK_CONFIG_TIMEOUT_MS = 3_000;

export type KioskConfig = { phoneCheckInEnabled: boolean };

/** Fail closed: any error, timeout or non-2xx response keeps the phone method hidden (FR-KPT-21). */
export async function fetchKioskConfig(fetchFn: typeof fetch = fetch): Promise<KioskConfig> {
	try {
		const response = await fetchFn('/api/v1/scanner/kiosk/config', {
			method: 'POST',
			cache: 'no-store',
			signal: AbortSignal.timeout(KIOSK_CONFIG_TIMEOUT_MS)
		});
		if (!response.ok) return { phoneCheckInEnabled: false };
		const body = (await response.json()) as { phone_check_in_enabled?: unknown };
		return { phoneCheckInEnabled: body.phone_check_in_enabled === true };
	} catch {
		return { phoneCheckInEnabled: false };
	}
}
