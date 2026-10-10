/**
 * Client helper for the service plane (`/api/v1/*`, `/api/back-office/*`). Sends the
 * session cookie and unwraps the contract error envelope
 * `{ error: { code, message, description? } }` (api-contract.md §2) into a thrown
 * Error whose message the UI can toast. Same-origin paths so the cookie is
 * first-party; the Node BFF serves these in staging/prod.
 */
/** Error from a non-2xx service response; carries the HTTP status for expiry/permission handling. */
export class ServiceRequestError extends Error {
	constructor(
		message: string,
		readonly status: number
	) {
		super(message);
		this.name = 'ServiceRequestError';
	}
}

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
		throw new ServiceRequestError(
			description ? `${message} — ${description}` : message,
			res.status
		);
	}
	return data as T;
}
