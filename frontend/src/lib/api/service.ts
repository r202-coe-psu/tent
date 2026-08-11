/**
 * Client helper for the service plane (`/api/v1/*`, `/api/back-office/*`). Sends the
 * session cookie and unwraps the contract error envelope
 * `{ error: { code, message, description? } }` (api-contract.md §2) into a thrown
 * Error whose message the UI can toast. Same-origin paths so the cookie is
 * first-party; the Node BFF serves these in staging/prod.
 */
export async function serviceFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		credentials: 'include',
		...init,
		headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers }
	});
	const data = (await res.json().catch(() => null)) as
		(T & { error?: { code: string; message: string; description?: string } }) | null;
	if (!res.ok) {
		const message = data?.error?.message || `Request failed (${res.status})`;
		const description = data?.error?.description;
		throw new Error(description ? `${message} — ${description}` : message);
	}
	return data as T;
}
