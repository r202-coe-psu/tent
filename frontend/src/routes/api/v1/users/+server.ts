import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	assertCanGrant,
	authorizeUserWrite,
	serviceError,
	ServiceError
} from '$lib/server/couch-admin';
import { createUser, deleteUser, listUsers, updateUser } from '$lib/server/user-service';
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
	affiliation_tags?: unknown;
	volunteer_id?: unknown;
	duty_window?: unknown;
	active?: unknown;
}

interface UpdateUserBody {
	name?: unknown;
	password?: unknown;
	display_name?: unknown;
	roles?: unknown;
	affiliation_tags?: unknown;
	volunteer_id?: unknown;
	duty_window?: unknown;
	active?: unknown;
}

/** `volunteer:{ulid}` — 26 Crockford base32 chars, the id shape every doc is minted with. */
const VOLUNTEER_ID_PATTERN = /^volunteer:[0-9A-HJKMNP-TV-Z]{26}$/;

/** `volunteer:{ulid}` or an explicit `null` to unlink; anything else is dropped. */
function parseVolunteerId(raw: unknown): string | null | undefined {
	if (raw === null) return null;
	if (typeof raw !== 'string') return undefined;
	const id = raw.trim();
	if (!id) return null;
	// A prefix test alone accepts a bare `volunteer:`, which persists a link to nothing.
	if (!VOLUNTEER_ID_PATTERN.test(id.toUpperCase())) {
		throw new ServiceError('VALIDATION', 'volunteer_id must look like volunteer:{ulid}');
	}
	return id;
}

/**
 * A duty window (CR-094 §2.3): both instants present, parseable and in order, or an explicit
 * `null` meaning permanent access. Recorded only — no endpoint gates on it yet.
 */
function parseDutyWindow(raw: unknown): { start_ts: string; end_ts: string } | null | undefined {
	if (raw === null) return null;
	if (typeof raw !== 'object' || raw === undefined) return undefined;
	const { start_ts, end_ts } = raw as { start_ts?: unknown; end_ts?: unknown };
	if (typeof start_ts !== 'string' || typeof end_ts !== 'string') {
		throw new ServiceError('VALIDATION', 'duty_window needs both start_ts and end_ts');
	}
	const start = Date.parse(start_ts);
	const end = Date.parse(end_ts);
	if (Number.isNaN(start) || Number.isNaN(end)) {
		throw new ServiceError('VALIDATION', 'duty_window timestamps must be ISO-8601');
	}
	if (start >= end) {
		throw new ServiceError('VALIDATION', 'duty_window end_ts must be after start_ts');
	}
	return { start_ts: new Date(start).toISOString(), end_ts: new Date(end).toISOString() };
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
		const validPassword = validatePassword(password);
		if (display_name.length < 1)
			throw new ServiceError('VALIDATION', 'display_name must be at least 1 character');

		assertCanGrant(caller, roles);
		await createUser({
			name,
			password: validPassword,
			display_name,
			roles,
			affiliation_tags,
			volunteer_id: parseVolunteerId(body.volunteer_id) ?? null,
			duty_window: parseDutyWindow(body.duty_window) ?? null,
			active: typeof body.active === 'boolean' ? body.active : true
		});
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

		await updateUser(
			name,
			{
				password,
				display_name,
				roles,
				affiliation_tags,
				volunteer_id: parseVolunteerId(body.volunteer_id),
				duty_window: parseDutyWindow(body.duty_window),
				active: typeof body.active === 'boolean' ? body.active : undefined
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
