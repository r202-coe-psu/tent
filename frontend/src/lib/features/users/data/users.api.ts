import { COUCH_URL } from '$lib/db/couch';

export interface CouchUserDoc {
	_id: string;
	_rev: string;
	name: string;
	roles: string[];
	type: string;
}

interface AllDocsResponse {
	rows: { id: string; doc: CouchUserDoc }[];
}

const USER_PREFIX = 'org.couchdb.user:';

// User management talks to CouchDB's _users database directly with the current
// user's session cookie — no admin escalation. CouchDB enforces that only a
// server admin may read/write _users; a non-admin gets 401/403, which we
// surface as a clear "no permission" error.
async function usersFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
	const res = await fetch(`${COUCH_URL}/_users${path}`, {
		credentials: 'include',
		...init,
		headers: {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			...init.headers
		}
	});

	if (res.status === 401 || res.status === 403) {
		throw new Error('You do not have permission to manage users (server admin required).');
	}

	const data = (await res.json().catch(() => null)) as
		| (T & { error?: string; reason?: string })
		| null;

	if (!res.ok) {
		throw new Error(data?.reason || data?.error || `CouchDB request failed (${res.status})`);
	}

	return data as T;
}

export async function listUsers(): Promise<CouchUserDoc[]> {
	const res = await usersFetch<AllDocsResponse>('/_all_docs?include_docs=true');
	return res.rows.filter((r) => r.id.startsWith(USER_PREFIX)).map((r) => r.doc);
}

export async function createUser(name: string, password: string): Promise<void> {
	await usersFetch(`/${USER_PREFIX}${encodeURIComponent(name)}`, {
		method: 'PUT',
		body: JSON.stringify({ name, password, roles: [], type: 'user' })
	});
}

export async function deleteUser(id: string, rev: string): Promise<void> {
	await usersFetch(`/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, {
		method: 'DELETE'
	});
}
