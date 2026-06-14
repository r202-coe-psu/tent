/**
 * Client helper for the service plane (`/api/v1/*`, `/api/admin/*`). Sends the
 * session cookie and unwraps the contract error envelope
 * `{ error: { code, message } }` (api-contract.md §2) into a thrown Error whose
 * message the UI can toast. Same-origin paths so the cookie is first-party;
 * the dev BFF serves these, a reverse proxy → FastAPI in prod.
 */
export async function serviceFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(path, {
		credentials: 'include',
		...init,
		headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...init.headers }
	});
	const data = (await res.json().catch(() => null)) as
		| (T & { error?: { code: string; message: string } })
		| null;
	if (!res.ok) {
		throw new Error(data?.error?.message || `Request failed (${res.status})`);
	}
	return data as T;
}
