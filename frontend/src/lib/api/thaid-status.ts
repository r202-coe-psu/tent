/**
 * Client helper — whether the browser should show/enable ThaiD registration.
 * Backed by GET /api/public/v1/thaid/status (dev mock OR keys configured AND config:app flag ON).
 */

export interface ThaidStatusResponse {
	enabled: boolean;
	isDev: boolean;
	mode: 'mock' | 'real';
}

let inflight: Promise<ThaidStatusResponse> | null = null;

export function clearThaidStatusCache(): void {
	inflight = null;
}

export async function fetchThaidRegistrationStatus(
	fetchFn: typeof fetch = fetch
): Promise<ThaidStatusResponse> {
	if (fetchFn === fetch && inflight) return inflight;

	const run = (async (): Promise<ThaidStatusResponse> => {
		try {
			const res = await fetchFn('/api/public/v1/thaid/status', {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) {
				const isDev = import.meta.env.DEV;
				return { enabled: isDev, isDev, mode: isDev ? 'mock' : 'real' };
			}
			const data = (await res.json()) as Partial<ThaidStatusResponse>;
			const isDev = Boolean(data.isDev ?? import.meta.env.DEV);
			return {
				enabled: data.enabled === true,
				isDev,
				mode: data.mode === 'mock' || isDev ? 'mock' : 'real'
			};
		} catch {
			const isDev = import.meta.env.DEV;
			return { enabled: isDev, isDev, mode: isDev ? 'mock' : 'real' };
		}
	})();

	if (fetchFn === fetch) {
		inflight = run;
		try {
			return await run;
		} catch {
			inflight = null;
			const isDev = import.meta.env.DEV;
			return { enabled: isDev, isDev, mode: isDev ? 'mock' : 'real' };
		}
	}
	return run;
}
