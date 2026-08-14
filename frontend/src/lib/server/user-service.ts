import { adminRaw, bootstrapAdminName, isProtectedBootstrapAdmin } from '$lib/server/couch-admin';
import { ServiceError, serviceErrorFromCouch, type Caller } from '$lib/server/couch-admin';
import {
	isAppSystemAdmin,
	isLastAppSystemAdmin,
	isStaffOnly,
	shelterCodeFromRoles
} from '$lib/auth/roles';
import { validatePassword } from '$lib/server/password-policy';

/**
 * User service — the ONLY module that writes CouchDB `_users` with admin creds.
 * Both `/api/v1/users` (role-gated) and `/api/register` (public, fixed role)
 * call it, so there is a single audited admin-write surface that mirrors the
 * future FastAPI route boundary. Authorization happens in the handlers
 * (couch-admin.authorizeUserWrite / assertCanGrant) BEFORE these run.
 *
 * Uses `adminRaw` (status, no throw) so failures map to contract
 * {@link ServiceError} codes with a safe `description` (no admin URL).
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

function toSummary(doc: CouchUserDoc): UserSummary {
	return {
		name: doc.name,
		roles: doc.roles ?? [],
		display_name: doc.display_name ?? null,
		shelter_id: doc.shelter_id ?? null,
		affiliation_tags: doc.affiliation_tags ?? []
	};
}

function logBlockedBootstrapAdmin(caller: string, target: string, action: string): void {
	console.warn(`[users] blocked ${action} of bootstrap admin "${target}" by "${caller}"`);
}

function rejectBootstrapMutation(caller: Caller, target: string, action: string): never {
	logBlockedBootstrapAdmin(caller.name, target, action);
	throw new ServiceError('FORBIDDEN', 'Cannot modify the system bootstrap admin');
}

async function fetchAllUserDocs(): Promise<CouchUserDoc[]> {
	const res = await adminRaw('/_users/_all_docs?include_docs=true', 'GET');
	if (res.status >= 400) throw serviceErrorFromCouch('list users', res.status, res.data);
	const rows = (res.data as { rows?: { id: string; doc: CouchUserDoc }[] })?.rows ?? [];
	return rows.filter((r) => r.id.startsWith(USER_PREFIX) && r.doc).map((r) => r.doc);
}

async function countAppSystemAdmins(): Promise<number> {
	const docs = await fetchAllUserDocs();
	return docs.filter((d) => isAppSystemAdmin(d.roles ?? [])).length;
}

async function assertNotLastAppSa(targetRoles: readonly string[]): Promise<void> {
	const count = await countAppSystemAdmins();
	if (isLastAppSystemAdmin(targetRoles, count)) {
		throw new ServiceError('FORBIDDEN', 'Cannot remove the last system admin');
	}
}

async function readUserDoc(name: string, action: string): Promise<CouchUserDoc> {
	const got = await adminRaw(`/_users/${userDocId(name)}`, 'GET');
	if (got.status === 404) {
		const body = got.data as { reason?: string } | null;
		if (body?.reason === 'Database does not exist.') {
			throw serviceErrorFromCouch(action, got.status, got.data);
		}
		throw new ServiceError('VALIDATION', `User "${name}" not found`);
	}
	if (got.status >= 400) throw serviceErrorFromCouch(action, got.status, got.data);
	return got.data as CouchUserDoc;
}

/** Create a `_users` login. Caller authorization + role validation happen first. */
export async function createUser(input: {
	name: string;
	password: string;
	display_name: string;
	roles: string[];
	affiliation_tags?: string[];
}): Promise<void> {
	const { name, display_name, roles, affiliation_tags } = input;
	const bootstrap = bootstrapAdminName();
	if (isProtectedBootstrapAdmin({ name, roles }, bootstrap)) {
		throw new ServiceError('FORBIDDEN', 'Cannot create a user with the bootstrap admin name');
	}
	const password = validatePassword(input.password);
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
	if (res.status >= 400) throw serviceErrorFromCouch('create user', res.status, res.data);
}

/** List users, scoped: SA sees all; a manager sees only their own shelter. */
export async function listUsers(caller: Caller): Promise<UserSummary[]> {
	const bootstrap = bootstrapAdminName();
	const all = (await fetchAllUserDocs())
		.filter((d) => !isProtectedBootstrapAdmin(d, bootstrap))
		.map(toSummary);
	if (caller.isSA) return all;
	const scope = `shelter:${caller.shelterCode}`;
	return all.filter((u) => u.roles.includes(scope));
}

/** Delete a user. A manager may only delete users within their own shelter. */
export async function deleteUser(name: string, caller: Caller): Promise<void> {
	const doc = await readUserDoc(name, 'read user');

	if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
		rejectBootstrapMutation(caller, name, 'delete');
	}

	if (!caller.isSA) {
		const scope = `shelter:${caller.shelterCode}`;
		if (!doc.roles?.includes(scope)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only remove users in their own shelter');
		}
		// Staff only — a manager cannot delete another manager (or themselves).
		if (!isStaffOnly(doc.roles ?? [])) {
			throw new ServiceError('FORBIDDEN', 'A manager may only remove staff users');
		}
	} else {
		await assertNotLastAppSa(doc.roles ?? []);
	}

	const res = await adminRaw(`/_users/${userDocId(name)}?rev=${doc._rev}`, 'DELETE');
	if (res.status >= 400) throw serviceErrorFromCouch('delete user', res.status, res.data);
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
	const doc = await readUserDoc(name, 'read user');

	if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
		rejectBootstrapMutation(caller, name, 'update');
	}

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
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
		}
	} else {
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
			if (isAppSystemAdmin(doc.roles ?? []) && !isAppSystemAdmin(input.roles)) {
				await assertNotLastAppSa(doc.roles ?? []);
			}
		}
	}

	const updatedDoc = {
		...doc,
		...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
		...(input.roles ? { roles: input.roles, shelter_id: shelterCodeFromRoles(input.roles) } : {}),
		...(input.affiliation_tags ? { affiliation_tags: input.affiliation_tags } : {})
	} as CouchUserDoc & { password?: string; password_sha?: string; salt?: string };

	if (input.password) {
		const password = validatePassword(input.password);
		updatedDoc.password = password;
		delete updatedDoc.password_sha;
		delete updatedDoc.salt;
	}

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('update user', res.status, res.data);
}
