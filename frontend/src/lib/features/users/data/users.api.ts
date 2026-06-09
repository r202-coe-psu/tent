export interface CouchUserDoc {
	_id: string;
	_rev: string;
	name: string;
	roles: string[];
	type: string;
}

// All privileged user management runs on the server endpoint
// (/api/admin/users), which holds the admin credentials and enforces that the
// caller is a CouchDB admin. The browser only sends its session cookie.

async function adminUsersFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`/api/admin/users${path}`, {
		credentials: 'include',
		...init,
		headers: { 'Content-Type': 'application/json', ...init.headers }
	});
	const data = (await res.json().catch(() => null)) as (T & { message?: string }) | null;
	if (!res.ok) {
		throw new Error((data as { message?: string } | null)?.message ?? `Request failed (${res.status})`);
	}
	return data as T;
}

export function listUsers(): Promise<CouchUserDoc[]> {
	return adminUsersFetch<CouchUserDoc[]>('');
}

export async function createUser(name: string, password: string): Promise<void> {
	await adminUsersFetch('', { method: 'POST', body: JSON.stringify({ name, password }) });
}

export async function deleteUser(id: string, rev: string): Promise<void> {
	await adminUsersFetch(
		`?id=${encodeURIComponent(id)}&rev=${encodeURIComponent(rev)}`,
		{ method: 'DELETE' }
	);
}
