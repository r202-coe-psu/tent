import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	assertCanGrant,
	authorizeUserWrite,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { createUser, deleteUser, listUsers, updateUser } from '$lib/server/user-service';

// Service plane `/api/v1/*` — dev BFF mirroring the canonical contract
// (api-contract.md §2/§3) so it is a drop-in swap for the future FastAPI.
// Holds CouchDB admin creds server-side; authorizes the caller by role first.
// Absent from the static prod build (a reverse proxy routes /api/v1/* → FastAPI).
export const prerender = false;

interface CreateUserBody {
	name?: unknown;
	password?: unknown;
	display_name?: unknown;
	roles?: unknown;
	affiliation_tags?: unknown;
}

interface UpdateUserBody {
	name?: unknown;
	password?: unknown;
	display_name?: unknown;
	roles?: unknown;
	affiliation_tags?: unknown;
}

/** POST { name, password, display_name, roles[], affiliation_tags? } — create a user (SA: any non-_admin; SM: own-shelter staff). */
export const POST: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as CreateUserBody;

		const name = typeof body.name === 'string' ? body.name.trim() : '';
		const password = typeof body.password === 'string' ? body.password : '';
		const display_name = typeof body.display_name === 'string' ? body.display_name.trim() : '';
		const roles = Array.isArray(body.roles)
			? body.roles.filter((r): r is string => typeof r === 'string')
			: [];
		const affiliation_tags = Array.isArray(body.affiliation_tags)
			? body.affiliation_tags.filter((t): t is string => typeof t === 'string')
			: [];

		if (name.length < 3) throw new ServiceError('VALIDATION', 'name must be at least 3 characters');
		if (password.length < 6)
			throw new ServiceError('VALIDATION', 'password must be at least 6 characters');
		if (display_name.length < 1)
			throw new ServiceError('VALIDATION', 'display_name must be at least 1 character');

		assertCanGrant(caller, roles);
		await createUser({ name, password, display_name, roles, affiliation_tags });
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};

/** PUT — update a user (SA: any; SM: own-shelter staff). */
export const PUT: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const body = (await request.json().catch(() => ({}))) as UpdateUserBody;

		const name = typeof body.name === 'string' ? body.name.trim() : '';
		if (!name) throw new ServiceError('VALIDATION', 'name is required');

		const roles = Array.isArray(body.roles)
			? body.roles.filter((r): r is string => typeof r === 'string')
			: undefined;
		const affiliation_tags = Array.isArray(body.affiliation_tags)
			? body.affiliation_tags.filter((t): t is string => typeof t === 'string')
			: undefined;
		const password =
			typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined;
		const display_name =
			typeof body.display_name === 'string' && body.display_name.trim().length > 0
				? body.display_name.trim()
				: undefined;

		await updateUser(name, { password, display_name, roles, affiliation_tags }, caller);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};

/** GET — list users (SA: all; SM: own shelter only). */
export const GET: RequestHandler = async ({ request }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		return json(await listUsers(caller));
	} catch (e) {
		return serviceError(e);
	}
};

/** DELETE ?name= — remove a user (SM scoped to own shelter). */
export const DELETE: RequestHandler = async ({ request, url }) => {
	try {
		const caller = await authorizeUserWrite(request.headers.get('cookie'));
		const name = url.searchParams.get('name');
		if (!name) throw new ServiceError('VALIDATION', 'name is required');
		await deleteUser(name, caller);
		return json({ ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
