import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminFetch, requireAdmin } from '$lib/server/couch-admin';

// Admin-only endpoints; never prerendered (static build omits them).
export const prerender = false;

interface CouchUserDoc {
	_id: string;
	_rev: string;
	name: string;
	roles: string[];
	type: string;
}

interface NotesSecurity {
	admins: { names: string[]; roles: string[] };
	members: { names: string[]; roles: string[] };
}

async function grantNotesAccess(username: string): Promise<void> {
	const security = await adminFetch<NotesSecurity>('/notes/_security');
	security.members ??= { names: [], roles: [] };
	security.members.names ??= [];
	if (!security.members.names.includes(username)) {
		security.members.names.push(username);
	}
	await adminFetch('/notes/_security', { method: 'PUT', body: JSON.stringify(security) });
}

async function revokeNotesAccess(username: string): Promise<void> {
	const security = await adminFetch<NotesSecurity>('/notes/_security');
	if (security.members?.names) {
		security.members.names = security.members.names.filter((n) => n !== username);
		await adminFetch('/notes/_security', { method: 'PUT', body: JSON.stringify(security) });
	}
}

export const GET: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	const res = await adminFetch<{ rows: { id: string; doc: CouchUserDoc }[] }>(
		'/_users/_all_docs?include_docs=true'
	);
	const users = res.rows.filter((r) => r.id.startsWith('org.couchdb.user:')).map((r) => r.doc);
	return json(users);
};

export const POST: RequestHandler = async ({ request }) => {
	await requireAdmin(request.headers.get('cookie'));
	const { name, password } = (await request.json().catch(() => ({}))) as {
		name?: string;
		password?: string;
	};
	if (!name || !password) throw error(400, 'name and password are required');

	await adminFetch(`/_users/org.couchdb.user:${encodeURIComponent(name)}`, {
		method: 'PUT',
		body: JSON.stringify({ name, password, roles: [], type: 'user' })
	});
	await grantNotesAccess(name);
	return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
	await requireAdmin(request.headers.get('cookie'));
	const id = url.searchParams.get('id');
	const rev = url.searchParams.get('rev');
	if (!id || !rev) throw error(400, 'id and rev are required');

	await adminFetch(`/_users/${encodeURIComponent(id)}?rev=${encodeURIComponent(rev)}`, {
		method: 'DELETE'
	});
	await revokeNotesAccess(id.replace('org.couchdb.user:', ''));
	return json({ ok: true });
};
