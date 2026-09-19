/**
 * Client helper — whether the browser should load/execute reCAPTCHA.
 * Backed by GET /api/public/v1/recaptcha (keys configured AND config:app flag ON).
 *
 * Do not assume ON from site key alone: that injects Google's script before the
 * operator flag is known. Always wait for this helper (or start UI as off).
 */

let inflight: Promise<boolean> | null = null;

export function clearRecaptchaStatusCache(): void {
	inflight = null;
}

export async function fetchRecaptchaEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
	if (fetchFn === fetch && inflight) return inflight;

	const run = (async () => {
		try {
			const res = await fetchFn('/api/public/v1/recaptcha', {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) return false;
			const data = (await res.json()) as { enabled?: unknown };
			return data.enabled === true;
		} catch {
			return false;
		}
	})();

	if (fetchFn === fetch) {
		inflight = run;
		try {
			return await run;
		} catch {
			inflight = null;
			return false;
		}
	}
	return run;
}
