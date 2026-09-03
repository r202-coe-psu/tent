import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	assertCanGrant,
	authorizeUserWrite,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { createOrMergeUser, deleteUser, listUsers, updateUser } from '$lib/server/user-service';
import { validatePassword } from '$lib/server/password-policy';

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
	personnel_type?: unknown;
	organization?: unknown;
	position?: unknown;
	phone?: unknown;
	email?: unknown;
	notes?: unknown;
	volunteer_id?: unknown;
	duty_window?: unknown;
	affiliation_tags?: unknown;
}

interface UpdateUserBody {
	name?: unknown;
	password?: unknown;
	display_name?: unknown;
	roles?: unknown;
	personnel_type?: unknown;
	organization?: unknown;
	position?: unknown;
	phone?: unknown;
	email?: unknown;
	notes?: unknown;
	volunteer_id?: unknown;
	duty_window?: unknown;
	active?: unknown;
	must_change_password?: unknown;
	affiliation_tags?: unknown;
}

/** POST — create a user (SA: any non-_admin; SM: own-shelter staff). */
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
		const personnel_type =
			body.personnel_type === 'volunteer' ? ('volunteer' as const) : ('staff' as const);
		const organization =
			typeof body.organization === 'string' && body.organization.trim().length > 0
				? body.organization.trim()
				: null;
		const position =
			typeof body.position === 'string' && body.position.trim().length > 0
				? body.position.trim()
				: null;
		const phone =
			typeof body.phone === 'string' && body.phone.trim().length > 0 ? body.phone.trim() : name;
		const email =
			typeof body.email === 'string' && body.email.trim().length > 0 ? body.email.trim() : null;
		const notes =
			typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null;
		const volunteer_id =
			typeof body.volunteer_id === 'string' && body.volunteer_id.trim().length > 0
				? body.volunteer_id.trim()
				: null;
		const duty_window =
			typeof body.duty_window === 'object' && body.duty_window !== null
				? (body.duty_window as { start_ts: string; end_ts: string })
				: null;
		const affiliation_tags = Array.isArray(body.affiliation_tags)
			? body.affiliation_tags.filter((t): t is string => typeof t === 'string')
			: [];

		if (name.length < 3) throw new ServiceError('VALIDATION', 'name must be at least 3 characters');
		const validPassword = validatePassword(password);
		if (display_name.length < 1)
			throw new ServiceError('VALIDATION', 'display_name must be at least 1 character');
		if (personnel_type === 'staff' && !organization) {
			throw new ServiceError('VALIDATION', 'organization is required for staff');
		}

		assertCanGrant(caller, roles);
		const result = await createOrMergeUser(
			{
				name,
				password: validPassword,
				display_name,
				roles,
				personnel_type,
				organization,
				position,
				phone,
				email,
				notes,
				volunteer_id,
				duty_window,
				affiliation_tags
			},
			caller
		);
		return json({ ok: true, merged: result.merged });
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
		const personnel_type =
			body.personnel_type === 'volunteer'
				? ('volunteer' as const)
				: body.personnel_type === 'staff'
					? ('staff' as const)
					: undefined;
		const organization =
			typeof body.organization === 'string' ? body.organization.trim() : undefined;
		const position = typeof body.position === 'string' ? body.position.trim() : undefined;
		const phone = typeof body.phone === 'string' ? body.phone.trim() : undefined;
		const email = typeof body.email === 'string' ? body.email.trim() : undefined;
		const notes = typeof body.notes === 'string' ? body.notes.trim() : undefined;
		const volunteer_id =
			typeof body.volunteer_id === 'string' ? body.volunteer_id.trim() : undefined;
		const duty_window =
			typeof body.duty_window === 'object' && body.duty_window !== null
				? (body.duty_window as { start_ts: string; end_ts: string })
				: undefined;
		const active = typeof body.active === 'boolean' ? body.active : undefined;
		const must_change_password =
			typeof body.must_change_password === 'boolean' ? body.must_change_password : undefined;
		const affiliation_tags = Array.isArray(body.affiliation_tags)
			? body.affiliation_tags.filter((t): t is string => typeof t === 'string')
			: undefined;
		const password =
			typeof body.password === 'string' && body.password.length > 0 ? body.password : undefined;
		const display_name =
			typeof body.display_name === 'string' && body.display_name.trim().length > 0
				? body.display_name.trim()
				: undefined;

		await updateUser(
			name,
			{
				password,
				display_name,
				roles,
				personnel_type,
				organization,
				position,
				phone,
				email,
				notes,
				volunteer_id,
				duty_window,
				active,
				must_change_password,
				affiliation_tags
			},
			caller
		);
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
