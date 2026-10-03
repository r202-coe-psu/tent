/**
 * Client helper — which sign-in methods `/login` shows (CR-141).
 * Backed by GET /api/public/v1/login-methods.
 */

export interface LoginMethodsResponse {
	password: boolean;
	google: boolean;
	thaid: boolean;
}

/** Fail closed on the password form; OAuth buttons only when the server said so. */
const FALLBACK: LoginMethodsResponse = { password: false, google: false, thaid: false };

let inflight: Promise<LoginMethodsResponse> | null = null;

export function clearLoginMethodsCache(): void {
	inflight = null;
}

export function parseLoginMethods(data: unknown): LoginMethodsResponse {
	const d = (data ?? {}) as Partial<Record<keyof LoginMethodsResponse, unknown>>;
	return { password: d.password === true, google: d.google === true, thaid: d.thaid === true };
}

export async function fetchLoginMethods(
	fetchFn: typeof fetch = fetch
): Promise<LoginMethodsResponse> {
	if (fetchFn === fetch && inflight) return inflight;

	const run = (async (): Promise<LoginMethodsResponse> => {
		try {
			const res = await fetchFn('/api/public/v1/login-methods', {
				headers: { Accept: 'application/json' }
			});
			if (!res.ok) return FALLBACK;
			return parseLoginMethods(await res.json());
		} catch {
			return FALLBACK;
		}
	})();

	if (fetchFn === fetch) inflight = run;
	return run;
}
