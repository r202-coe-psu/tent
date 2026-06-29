import { adminRaw } from '$lib/server/couch-admin';
import { ServiceError, type Caller } from '$lib/server/couch-admin';
import { isStaffOnly, shelterCodeFromRoles } from '$lib/auth/roles';

/**
 * User service — the ONLY module that writes CouchDB `_users` with admin creds.
 * Both `/api/v1/users` (role-gated) and `/api/register` (public, fixed role)
 * call it, so there is a single audited admin-write surface that mirrors the
 * future FastAPI route boundary. Authorization happens in the handlers
 * (couch-admin.authorizeUserWrite / assertCanGrant) BEFORE these run.
 *
 * Uses `adminRaw` (status, no throw) so CouchDB reasons never leak — failures
 * map to contract {@link ServiceError} codes.
 */

const USER_PREFIX = 'org.couchdb.user:';

export interface UserSummary {
	name: string;
	roles: string[];
	display_name?: string | null;
	shelter_id?: string | null;
	affiliation_tags?: string[];
}

interface CouchUserDoc {
	_id: string;
	_rev: string;
	name: string;
	roles: string[];
	type: string;
	display_name?: string | null;
	shelter_id?: string | null;
	affiliation_tags?: string[];
}

function userDocId(name: string): string {
	return `${USER_PREFIX}${encodeURIComponent(name)}`;
}

/** Create a `_users` login. Caller authorization + role validation happen first. */
export async function createUser(input: {
	name: string;
	password: string;
	display_name: string;
	roles: string[];
	affiliation_tags?: string[];
}): Promise<void> {
	const { name, password, display_name, roles, affiliation_tags } = input;
	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', {
		name,
		password,
		display_name,
		roles,
		type: 'user',
		shelter_id: shelterCodeFromRoles(roles),
		affiliation_tags: affiliation_tags ?? []
	});
	if (res.status === 409) throw new ServiceError('CONFLICT', `User "${name}" already exists`);
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not create user');
}

/** List users, scoped: SA sees all; a manager sees only their own shelter. */
export async function listUsers(caller: Caller): Promise<UserSummary[]> {
	const res = await adminRaw('/_users/_all_docs?include_docs=true', 'GET');
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not list users');
	const rows = (res.data as { rows?: { id: string; doc: CouchUserDoc }[] })?.rows ?? [];
	const all = rows
		.filter((r) => r.id.startsWith(USER_PREFIX) && r.doc)
		.map((r) => ({
			name: r.doc.name,
			roles: r.doc.roles ?? [],
			display_name: r.doc.display_name ?? null,
			shelter_id: r.doc.shelter_id ?? null,
			affiliation_tags: r.doc.affiliation_tags ?? []
		}));
	if (caller.isSA) return all;
	const scope = `shelter:${caller.shelterCode}`;
	return all.filter((u) => u.roles.includes(scope));
}

/** Delete a user. A manager may only delete users within their own shelter. */
export async function deleteUser(name: string, caller: Caller): Promise<void> {
	const got = await adminRaw(`/_users/${userDocId(name)}`, 'GET');
	if (got.status === 404) throw new ServiceError('VALIDATION', `User "${name}" not found`);
	if (got.status >= 400) throw new ServiceError('INTERNAL', 'Could not read user');
	const doc = got.data as CouchUserDoc;

	if (!caller.isSA) {
		const scope = `shelter:${caller.shelterCode}`;
		if (!doc.roles?.includes(scope)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only remove users in their own shelter');
		}
		// Staff only — a manager cannot delete another manager (or themselves).
		if (!isStaffOnly(doc.roles ?? [])) {
			throw new ServiceError('FORBIDDEN', 'A manager may only remove staff users');
		}
	}
	const res = await adminRaw(`/_users/${userDocId(name)}?rev=${doc._rev}`, 'DELETE');
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not delete user');
}

/** Update an existing user. A manager may only edit users in their own shelter and only staff. */
export async function updateUser(
	name: string,
	input: {
		password?: string;
		display_name?: string;
		roles?: string[];
		affiliation_tags?: string[];
	},
	caller: Caller
): Promise<void> {
	const got = await adminRaw(`/_users/${userDocId(name)}`, 'GET');
	if (got.status === 404) throw new ServiceError('VALIDATION', `User "${name}" not found`);
	if (got.status >= 400) throw new ServiceError('INTERNAL', 'Could not read user');
	const doc = got.data as CouchUserDoc;

	// Authorize changes
	if (!caller.isSA) {
		const scope = `shelter:${caller.shelterCode}`;
		if (!doc.roles?.includes(scope)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only edit users in their own shelter');
		}
		// Staff only — a manager cannot edit another manager (or themselves).
		if (!isStaffOnly(doc.roles ?? [])) {
			throw new ServiceError('FORBIDDEN', 'A manager may only edit staff users');
		}
		// If caller tries to change roles to something outside their scope:
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
		}
	} else {
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
		}
	}

	const updatedDoc = {
		...doc,
		...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
		...(input.roles ? { roles: input.roles, shelter_id: shelterCodeFromRoles(input.roles) } : {}),
		...(input.affiliation_tags ? { affiliation_tags: input.affiliation_tags } : {})
	} as CouchUserDoc & { password?: string; password_sha?: string; salt?: string };

	if (input.password && input.password.trim().length >= 6) {
		updatedDoc.password = input.password;
		delete updatedDoc.password_sha;
		delete updatedDoc.salt;
	}

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw new ServiceError('INTERNAL', 'Could not update user');
}
