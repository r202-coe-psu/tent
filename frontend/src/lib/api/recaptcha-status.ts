/**
 * Client helper — whether the browser should load/execute reCAPTCHA.
 * Backed by GET /api/public/v1/recaptcha (keys configured AND config:app flag ON).
 *
 * Do not assume ON from site key alone: that injects Google's script before the
 * operator flag is known. Always wait for this helper (or start UI as off).
 *
 * Only a confirmed `true` is remembered for the life of the tab. `false` (flag off, a
 * non-2xx answer, a network blip) is never cached: the operator can switch the flag on
 * while a page is open, and a single failed fetch must not make every later submit go
 * out without a token that the server then demands. Re-asking costs one tiny GET and
 * only happens while the answer is not `true`. A cached `true` going stale (flag turned
 * off) is harmless — the client just sends a token the server ignores.
 */

let enabledCache = false;
let pending: Promise<boolean> | null = null;

export function clearRecaptchaStatusCache(): void {
	enabledCache = false;
	pending = null;
}

async function queryStatus(fetchFn: typeof fetch): Promise<boolean> {
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
}

export async function fetchRecaptchaEnabled(fetchFn: typeof fetch = fetch): Promise<boolean> {
	if (fetchFn !== fetch) return queryStatus(fetchFn);
	if (enabledCache) return true;
	// Coalesce simultaneous callers (mount + submit) into one request.
	if (pending) return pending;

	const run = queryStatus(fetchFn).then((enabled) => {
		if (enabled) enabledCache = true;
		return enabled;
	});
	pending = run;
	try {
		return await run;
	} finally {
		if (pending === run) pending = null;
	}
}
