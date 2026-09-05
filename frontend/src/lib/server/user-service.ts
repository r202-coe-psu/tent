import { adminRaw, bootstrapAdminName, isProtectedBootstrapAdmin } from '$lib/server/couch-admin';
import { ServiceError, serviceErrorFromCouch, type Caller } from '$lib/server/couch-admin';
import {
	isAppSystemAdmin,
	isLastAppSystemAdmin,
	isStaffOnly,
	shelterCodeFromRoles
} from '$lib/auth/roles';
import { validatePassword, validateProvisionedPassword } from '$lib/server/password-policy';
import {
	hashSecurityAnswer,
	verifySecurityAnswer,
	getSecurityQuestionLabel
} from '$lib/server/security-questions';
import { generateTemporaryPassphrase } from '$lib/server/passphrase-generator';

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
	personnel_type?: 'staff' | 'volunteer';
	organization?: string | null;
	position?: string | null;
	phone?: string | null;
	email?: string | null;
	notes?: string | null;
	volunteer_id?: string | null;
	duty_window?: {
		start_ts: string;
		end_ts: string;
	} | null;
	active?: boolean;
	must_change_password?: boolean;
	has_security_question?: boolean;
	affiliation_tags?: string[];
}

export interface CouchUserDoc {
	_id: string;
	_rev?: string;
	name: string;
	roles: string[];
	type: string;
	display_name?: string | null;
	shelter_id?: string | null;
	personnel_type?: 'staff' | 'volunteer';
	organization?: string | null;
	position?: string | null;
	phone?: string | null;
	email?: string | null;
	notes?: string | null;
	volunteer_id?: string | null;
	duty_window?: {
		start_ts: string;
		end_ts: string;
	} | null;
	active?: boolean;
	must_change_password?: boolean;
	security_question?: {
		question_id: string;
		answer_hash: string;
		salt: string;
		set_at: string;
	} | null;
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
		personnel_type: doc.personnel_type ?? 'staff',
		organization: doc.organization ?? null,
		position: doc.position ?? null,
		phone: doc.phone ?? doc.name,
		email: doc.email ?? null,
		notes: doc.notes ?? null,
		volunteer_id: doc.volunteer_id ?? null,
		duty_window: doc.duty_window ?? null,
		active: doc.active ?? true,
		must_change_password: doc.must_change_password ?? false,
		has_security_question: Boolean(doc.security_question?.answer_hash),
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
	personnel_type?: 'staff' | 'volunteer';
	organization?: string | null;
	position?: string | null;
	phone?: string | null;
	email?: string | null;
	notes?: string | null;
	volunteer_id?: string | null;
	duty_window?: {
		start_ts: string;
		end_ts: string;
	} | null;
	active?: boolean;
	must_change_password?: boolean;
	security_question?: {
		question_id: string;
		answer_hash: string;
		salt: string;
		set_at: string;
	} | null;
	affiliation_tags?: string[];
}): Promise<void> {
	const {
		name,
		display_name,
		roles,
		personnel_type = 'staff',
		organization,
		position,
		phone,
		email,
		notes,
		volunteer_id,
		duty_window,
		active = true,
		must_change_password = false,
		security_question,
		affiliation_tags
	} = input;
	const bootstrap = bootstrapAdminName();
	if (isProtectedBootstrapAdmin({ name, roles }, bootstrap)) {
		throw new ServiceError('FORBIDDEN', 'Cannot create a user with the bootstrap admin name');
	}
	const password = validateProvisionedPassword(input.password, {
		phone,
		personnelType: personnel_type,
		mustChangePassword: must_change_password
	});
	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', {
		name,
		password,
		display_name,
		roles,
		type: 'user',
		shelter_id: shelterCodeFromRoles(roles),
		personnel_type,
		organization: organization ?? null,
		position: position ?? null,
		phone: phone ?? name,
		email: email ?? null,
		notes: notes ?? null,
		volunteer_id: volunteer_id ?? null,
		duty_window: duty_window ?? null,
		active,
		must_change_password,
		security_question: security_question ?? null,
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
		personnel_type?: 'staff' | 'volunteer';
		organization?: string | null;
		position?: string | null;
		phone?: string | null;
		email?: string | null;
		notes?: string | null;
		volunteer_id?: string | null;
		duty_window?: {
			start_ts: string;
			end_ts: string;
		} | null;
		active?: boolean;
		must_change_password?: boolean;
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
		...(input.personnel_type !== undefined ? { personnel_type: input.personnel_type } : {}),
		...(input.organization !== undefined ? { organization: input.organization } : {}),
		...(input.position !== undefined ? { position: input.position } : {}),
		...(input.phone !== undefined ? { phone: input.phone } : {}),
		...(input.email !== undefined ? { email: input.email } : {}),
		...(input.notes !== undefined ? { notes: input.notes } : {}),
		...(input.volunteer_id !== undefined ? { volunteer_id: input.volunteer_id } : {}),
		...(input.duty_window !== undefined ? { duty_window: input.duty_window } : {}),
		...(input.active !== undefined ? { active: input.active } : {}),
		...(input.must_change_password !== undefined
			? { must_change_password: input.must_change_password }
			: {}),
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

/** Admin resets user password to a memorable temporary passphrase. */
export async function resetUserPasswordByAdmin(
	name: string,
	caller: Caller
): Promise<{ temporary_password: string }> {
	const doc = await readUserDoc(name, 'read user');

	if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
		rejectBootstrapMutation(caller, name, 'reset password');
	}

	if (!caller.isSA) {
		const scope = `shelter:${caller.shelterCode}`;
		if (!doc.roles?.includes(scope)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only reset users in their own shelter');
		}
		if (!isStaffOnly(doc.roles ?? [])) {
			throw new ServiceError('FORBIDDEN', 'A manager may only reset staff users');
		}
	}

	const temporary_password = generateTemporaryPassphrase();
	const validPassword = validatePassword(temporary_password);

	const updatedDoc = {
		...doc,
		password: validPassword,
		must_change_password: true
	} as CouchUserDoc & { password?: string; password_sha?: string; salt?: string };

	delete updatedDoc.password_sha;
	delete updatedDoc.salt;

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('admin reset password', res.status, res.data);

	return { temporary_password };
}

/** Get security question challenge for a user by phone/username */
export async function getSecurityQuestionChallenge(phoneOrUsername: string): Promise<{
	found: boolean;
	question_id?: string;
	question_label?: string;
}> {
	const name = phoneOrUsername.trim();
	try {
		const doc = await readUserDoc(name, 'get security question');
		if (!doc.security_question?.question_id) {
			return { found: true, question_id: undefined, question_label: undefined };
		}
		const label = getSecurityQuestionLabel(doc.security_question.question_id);
		return {
			found: true,
			question_id: doc.security_question.question_id,
			question_label: label ?? undefined
		};
	} catch (e) {
		if (e instanceof ServiceError && e.code === 'VALIDATION') {
			return { found: false };
		}
		throw e;
	}
}

/** Verify security question answer and update user password directly (Self-Service) */
export async function verifySecurityQuestionAndResetPassword(
	phoneOrUsername: string,
	question_id: string,
	rawAnswer: string,
	newPassword: string
): Promise<void> {
	const name = phoneOrUsername.trim();
	const doc = await readUserDoc(name, 'verify security question');

	if (!doc.security_question || doc.security_question.question_id !== question_id) {
		throw new ServiceError('VALIDATION', 'คำถามความปลอดภัยไม่ถูกต้องหรือไม่พบบัญชีนี้');
	}

	const isValid = verifySecurityAnswer(
		rawAnswer,
		doc.security_question.salt,
		doc.security_question.answer_hash
	);

	if (!isValid) {
		throw new ServiceError('VALIDATION', 'คำตอบความปลอดภัยไม่ถูกต้อง');
	}

	const validPassword = validatePassword(newPassword);
	const updatedDoc = {
		...doc,
		password: validPassword,
		must_change_password: false
	} as CouchUserDoc & { password?: string; password_sha?: string; salt?: string };

	delete updatedDoc.password_sha;
	delete updatedDoc.salt;

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('reset password', res.status, res.data);
}

/** First-time login / Force setup: set security question and optionally update password */
export async function setupSecurityQuestionAndResetPassword(input: {
	username: string;
	new_password?: string;
	question_id: string;
	raw_answer: string;
}): Promise<void> {
	const { username, new_password, question_id, raw_answer } = input;
	const doc = await readUserDoc(username, 'setup security question');

	const { answer_hash, salt } = hashSecurityAnswer(raw_answer);

	const updatedDoc = {
		...doc,
		must_change_password: false,
		security_question: {
			question_id,
			answer_hash,
			salt,
			set_at: new Date().toISOString()
		}
	} as CouchUserDoc & { password?: string; password_sha?: string; salt?: string };

	if (new_password) {
		const validPassword = validatePassword(new_password);
		updatedDoc.password = validPassword;
		delete updatedDoc.password_sha;
		delete updatedDoc.salt;
	}

	const res = await adminRaw(`/_users/${userDocId(username)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('force setup', res.status, res.data);
}
