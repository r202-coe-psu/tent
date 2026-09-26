import { adminRaw, bootstrapAdminName, isProtectedBootstrapAdmin } from '$lib/server/couch-admin';
import { ServiceError, serviceErrorFromCouch, type Caller } from '$lib/server/couch-admin';
import {
	SHELTER_MANAGER,
	STAFF_CAPABILITIES,
	capabilitiesForShelter,
	hasShelterScope,
	isAppSystemAdmin,
	isLastAppSystemAdmin,
	managerShelterCodes,
	mergeShelterAssignment,
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

/** MFA IdP — Google OIDC (CR-124) and ThaID Digital ID BORA (CR-ThaID). */
export type MfaProviderType = 'google' | 'thaid';

export interface MfaProvider {
	type: MfaProviderType;
	/** OIDC `sub` — stable identity; never use email or citizen ID as primary. */
	subject: string;
	/** Display-only (Google email). */
	email?: string | null;
	/** Display-only (ThaID full name in Thai). */
	name?: string | null;
	/** Display-only (ThaID masked citizen ID: 1-xxxx-xxxxx-12-3). */
	pid_masked?: string | null;
	linked_at: string;
	verified_at?: string | null;
}

export interface UserMfa {
	providers: MfaProvider[];
}

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
	/** True when at least one MFA provider (Google or ThaID) is linked. */
	mfa_enrolled?: boolean;
	/** CR-124 — linked Google email for display (admin / me). */
	mfa_google_email?: string | null;
	/** CR-ThaID — linked ThaID name for display. */
	mfa_thaid_name?: string | null;
	/** CR-ThaID — linked ThaID masked PID for display. */
	mfa_thaid_pid_masked?: string | null;
}

export async function getCurrentUserProfile(
	name: string
): Promise<Pick<UserSummary, 'name' | 'display_name'>> {
	try {
		const user = toSummary(await readUserDoc(name, 'read current user'));
		return { name: user.name, display_name: user.display_name };
	} catch (e) {
		// Session can exist without a `_users` profile doc (bootstrap CouchDB
		// admin). Match `/api/v1/auth/me` — fall back to username, don't 422.
		if (e instanceof ServiceError && e.code === 'VALIDATION') {
			return { name, display_name: name };
		}
		throw e;
	}
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
	/** CR-124 — null / missing = not enrolled for Google step-up. */
	mfa?: UserMfa | null;
	/** CouchDB password salt — required to mint AuthSession (Phase 2). */
	salt?: string;
}

function userDocId(name: string): string {
	return `${USER_PREFIX}${encodeURIComponent(name)}`;
}

/** Return the Google MFA provider on a `_users` doc, or null. */
export function getGoogleMfa(doc: CouchUserDoc): MfaProvider | null {
	const providers = doc.mfa?.providers;
	if (!providers?.length) return null;
	return providers.find((p) => p.type === 'google') ?? null;
}

/** Return the ThaID MFA provider on a `_users` doc, or null. */
export function getThaidMfa(doc: CouchUserDoc): MfaProvider | null {
	const providers = doc.mfa?.providers;
	if (!providers?.length) return null;
	return providers.find((p) => p.type === 'thaid') ?? null;
}

function toSummary(doc: CouchUserDoc): UserSummary {
	const google = getGoogleMfa(doc);
	const thaid = getThaidMfa(doc);
	return {
		name: doc.name,
		roles: doc.roles ?? [],
		display_name: doc.display_name ?? null,
		shelter_id: doc.shelter_id ?? null,
		personnel_type: doc.personnel_type ?? 'staff',
		organization: doc.organization ?? null,
		position: doc.position ?? null,
		phone: doc.phone ?? null,
		email: doc.email ?? null,
		notes: doc.notes ?? null,
		volunteer_id: doc.volunteer_id ?? null,
		duty_window: doc.duty_window ?? null,
		active: doc.active ?? true,
		must_change_password: doc.must_change_password ?? false,
		has_security_question: Boolean(doc.security_question?.answer_hash),
		affiliation_tags: doc.affiliation_tags ?? [],
		mfa_enrolled: Boolean(google || thaid),
		mfa_google_email: google?.email ?? null,
		mfa_thaid_name: thaid?.name ?? null,
		mfa_thaid_pid_masked: thaid?.pid_masked ?? null
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

const PHONE_LOGIN_RE = /^0\d{9}$/;

function normalizePhone(value: string | null | undefined): string | null {
	if (value == null) return null;
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * When phone is set it must be unique across `_users.phone` and must not collide
 * with another account's CouchDB `name` (so alternate login stays unambiguous).
 */
async function assertPhoneAvailable(
	phone: string | null,
	excludeName?: string
): Promise<string | null> {
	const normalized = normalizePhone(phone);
	if (!normalized) return null;
	if (!PHONE_LOGIN_RE.test(normalized)) {
		throw new ServiceError('VALIDATION', 'เบอร์โทรศัพท์ต้องเป็นตัวเลข 10 หลักขึ้นต้นด้วย 0');
	}

	const docs = await fetchAllUserDocs();
	for (const doc of docs) {
		if (excludeName && doc.name === excludeName) continue;
		if (doc.name === normalized) {
			throw new ServiceError(
				'CONFLICT',
				`เบอร์ "${normalized}" ชนกับ username ของบัญชีอื่น`
			);
		}
		if (doc.phone === normalized) {
			throw new ServiceError('CONFLICT', `เบอร์ "${normalized}" ถูกใช้โดยบัญชีอื่นแล้ว`);
		}
	}
	return normalized;
}

/** Resolve a login identifier to CouchDB `name` (username or contact phone). */
export async function resolveLoginName(identifier: string): Promise<string> {
	const raw = identifier.trim();
	if (!raw) return raw;

	try {
		await readUserDoc(raw, 'resolve login');
		return raw;
	} catch (e) {
		if (!(e instanceof ServiceError) || e.code !== 'VALIDATION') throw e;
	}

	if (!PHONE_LOGIN_RE.test(raw)) return raw;

	const docs = await fetchAllUserDocs();
	const match = docs.find((d) => d.phone === raw);
	return match?.name ?? raw;
}

/** Find CouchDB username whose contact `phone` matches (or null). */
export async function findUserNameByPhone(phone: string): Promise<string | null> {
	const normalized = normalizePhone(phone);
	if (!normalized || !PHONE_LOGIN_RE.test(normalized)) return null;
	const docs = await fetchAllUserDocs();
	return docs.find((d) => d.phone === normalized)?.name ?? null;
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
	const normalizedPhone = await assertPhoneAvailable(phone ?? null, name);
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
		phone: normalizedPhone,
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

/**
 * Create a user, or if the username already exists and the caller is a manager,
 * merge the caller's shelter assignment into the existing account (add from outside).
 */
export async function createOrMergeUser(
	input: Parameters<typeof createUser>[0],
	caller: Caller
): Promise<{ merged: boolean }> {
	try {
		await createUser(input);
		return { merged: false };
	} catch (e) {
		if (!(e instanceof ServiceError) || e.code !== 'CONFLICT' || caller.isSA) throw e;
		const managed = managerShelterCodes(caller.roles);
		const code = managed[0] ?? caller.shelterCode;
		if (!code) throw e;
		const caps = capabilitiesForShelter(input.roles, code);
		if (caps.length === 0) throw e;
		await updateUser(
			input.name,
			{
				display_name: input.display_name,
				roles: input.roles,
				personnel_type: input.personnel_type,
				organization: input.organization,
				position: input.position,
				phone: input.phone,
				email: input.email,
				notes: input.notes,
				volunteer_id: input.volunteer_id,
				duty_window: input.duty_window,
				affiliation_tags: input.affiliation_tags
			},
			caller
		);
		return { merged: true };
	}
}

/** List users, scoped: SA sees all; a manager sees users with their managed shelter scope. */
export async function listUsers(caller: Caller): Promise<UserSummary[]> {
	const bootstrap = bootstrapAdminName();
	const all = (await fetchAllUserDocs())
		.filter((d) => !isProtectedBootstrapAdmin(d, bootstrap))
		.map(toSummary);
	if (caller.isSA) return all;
	const managed = managerShelterCodes(caller.roles);
	const codes = managed.length > 0 ? managed : caller.shelterCode ? [caller.shelterCode] : [];
	return all.filter((u) => codes.some((code) => hasShelterScope(u.roles, code)));
}

function managerMayMutateTarget(caller: Caller, targetRoles: readonly string[]): string {
	if (isAppSystemAdmin(targetRoles)) {
		throw new ServiceError('FORBIDDEN', 'A manager may not modify a system admin');
	}
	const managed = managerShelterCodes(caller.roles);
	const code = managed[0] ?? caller.shelterCode;
	if (!code) {
		throw new ServiceError('FORBIDDEN', 'Manager has no shelter scope');
	}
	// Allow add-from-outside: target need not already be in this shelter.
	const capsHere = capabilitiesForShelter(targetRoles, code);
	if (capsHere.includes(SHELTER_MANAGER)) {
		throw new ServiceError('FORBIDDEN', 'A manager may not modify another shelter manager');
	}
	const staff = STAFF_CAPABILITIES as readonly string[];
	if (capsHere.some((c) => !staff.includes(c))) {
		throw new ServiceError('FORBIDDEN', 'A manager may only manage staff users in their shelter');
	}
	return code;
}

/** Delete a user. A manager strips own-shelter assignment; full delete only if no shelters remain. */
export async function deleteUser(name: string, caller: Caller): Promise<void> {
	const doc = await readUserDoc(name, 'read user');

	if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
		rejectBootstrapMutation(caller, name, 'delete');
	}

	if (!caller.isSA) {
		const code = managerMayMutateTarget(caller, doc.roles ?? []);
		if (!hasShelterScope(doc.roles ?? [], code)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only remove users in their own shelter');
		}
		const remaining = mergeShelterAssignment(doc.roles ?? [], code, []);
		if (remaining.length > 0) {
			const updatedDoc = {
				...doc,
				roles: remaining,
				shelter_id: shelterCodeFromRoles(remaining)
			};
			const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
			if (res.status >= 400) throw serviceErrorFromCouch('delete user', res.status, res.data);
			return;
		}
	} else {
		await assertNotLastAppSa(doc.roles ?? []);
	}

	const res = await adminRaw(`/_users/${userDocId(name)}?rev=${doc._rev}`, 'DELETE');
	if (res.status >= 400) throw serviceErrorFromCouch('delete user', res.status, res.data);
}

/** Update an existing user. Managers merge roles for their shelter only. */
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

	let nextRoles = input.roles;

	if (!caller.isSA) {
		const code = managerMayMutateTarget(caller, doc.roles ?? []);
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
			const caps = capabilitiesForShelter(input.roles, code);
			nextRoles = mergeShelterAssignment(doc.roles ?? [], code, caps);
		}
	} else {
		if (input.roles) {
			const { assertCanGrant } = await import('./couch-admin');
			assertCanGrant(caller, input.roles);
			if (isAppSystemAdmin(doc.roles ?? []) && !isAppSystemAdmin(input.roles)) {
				await assertNotLastAppSa(doc.roles ?? []);
			}
			nextRoles = input.roles;
		}
	}

	const updatedDoc = {
		...doc,
		...(input.display_name !== undefined ? { display_name: input.display_name } : {}),
		...(nextRoles ? { roles: nextRoles, shelter_id: shelterCodeFromRoles(nextRoles) } : {}),
		...(input.personnel_type !== undefined ? { personnel_type: input.personnel_type } : {}),
		...(input.organization !== undefined ? { organization: input.organization } : {}),
		...(input.position !== undefined ? { position: input.position } : {}),
		...(input.phone !== undefined
			? { phone: await assertPhoneAvailable(input.phone, name) }
			: {}),
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

/** Fields a logged-in staff member may change on their own `_users` doc (no roles/password/MFA). */
export type OwnProfileFields = {
	display_name?: string;
	phone?: string | null;
	email?: string | null;
	organization?: string | null;
	position?: string | null;
};

const OWN_PROFILE_KEYS = new Set<string>([
	'display_name',
	'phone',
	'email',
	'organization',
	'position'
]);

function normalizeOptionalText(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') {
		throw new ServiceError('VALIDATION', 'Profile fields must be strings or null');
	}
	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : null;
}

/**
 * Self-service profile update for the session user only.
 * Does not call {@link updateUser} / manager authorization — any authenticated staff may
 * update these soft fields on their own doc. Rejects unknown keys and empty display_name.
 */
export async function updateOwnProfile(
	name: string,
	fields: OwnProfileFields & Record<string, unknown>
): Promise<UserSummary> {
	const keys = Object.keys(fields);
	const rejected = keys.filter((k) => !OWN_PROFILE_KEYS.has(k));
	if (rejected.length > 0) {
		throw new ServiceError('VALIDATION', `Cannot update restricted fields: ${rejected.join(', ')}`);
	}
	if (keys.length === 0) {
		throw new ServiceError('VALIDATION', 'No profile fields to update');
	}

	const doc = await readUserDoc(name, 'read own profile');

	const patch: Partial<CouchUserDoc> = {};

	if ('display_name' in fields) {
		const displayName = normalizeOptionalText(fields.display_name);
		if (!displayName) {
			throw new ServiceError('VALIDATION', 'ชื่อที่แสดงต้องไม่ว่าง');
		}
		patch.display_name = displayName;
	}
	if ('phone' in fields) {
		patch.phone = await assertPhoneAvailable(normalizeOptionalText(fields.phone), name);
	}
	if ('email' in fields) {
		patch.email = normalizeOptionalText(fields.email);
	}
	if ('organization' in fields) {
		patch.organization = normalizeOptionalText(fields.organization);
	}
	if ('position' in fields) {
		patch.position = normalizeOptionalText(fields.position);
	}

	const updatedDoc = { ...doc, ...patch };
	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('update own profile', res.status, res.data);

	const summary = toSummary(updatedDoc);
	// Do not fall back phone→username for self-profile (admin list still uses toSummary).
	return {
		...summary,
		phone: updatedDoc.phone ?? null,
		email: updatedDoc.email ?? null,
		organization: updatedDoc.organization ?? null,
		position: updatedDoc.position ?? null
	};
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
		const code = managerMayMutateTarget(caller, doc.roles ?? []);
		if (!hasShelterScope(doc.roles ?? [], code)) {
			throw new ServiceError('FORBIDDEN', 'A manager may only reset users in their own shelter');
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
	const name = await resolveLoginName(phoneOrUsername);
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
	const name = await resolveLoginName(phoneOrUsername);
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

/**
 * Find the single `_users` doc with a Google MFA provider matching `subject` (CR-124 Phase 2).
 * Returns null when not enrolled / unknown. Uniqueness is enforced at link time.
 */
export async function findUserByGoogleSubject(subject: string): Promise<CouchUserDoc | null> {
	const trimmed = subject.trim();
	if (!trimmed) return null;

	const all = await fetchAllUserDocs();
	for (const doc of all) {
		const linked = getGoogleMfa(doc);
		if (linked && linked.subject === trimmed) {
			return doc;
		}
	}
	return null;
}

/**
 * Link a Google OIDC identity as step-up MFA (CR-124).
 * Enforces one Google per user and global uniqueness of `subject`.
 */
export async function linkGoogleMfa(
	name: string,
	input: { subject: string; email?: string | null }
): Promise<void> {
	const subject = input.subject.trim();
	if (!subject) {
		throw new ServiceError('VALIDATION', 'Google subject is required');
	}

	const all = await fetchAllUserDocs();
	for (const other of all) {
		const linked = getGoogleMfa(other);
		if (linked && linked.subject === subject && other.name !== name) {
			throw new ServiceError('CONFLICT', 'Google account is already linked to another user');
		}
	}

	const doc = await readUserDoc(name, 'link google mfa');
	if (getGoogleMfa(doc)) {
		throw new ServiceError('CONFLICT', 'User already has a Google MFA provider linked');
	}

	const now = new Date().toISOString();
	const provider: MfaProvider = {
		type: 'google',
		subject,
		email: input.email ?? null,
		linked_at: now,
		verified_at: now
	};

	const updatedDoc: CouchUserDoc = {
		...doc,
		mfa: { providers: [...(doc.mfa?.providers ?? []).filter((p) => p.type !== 'google'), provider] }
	};

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('link google mfa', res.status, res.data);
}

/** Clear Google MFA link. Pass `caller` for admin/manager authz; omit for self-service. */
export async function unlinkGoogleMfa(name: string, caller?: Caller): Promise<void> {
	const doc = await readUserDoc(name, 'unlink google mfa');

	if (caller) {
		if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
			rejectBootstrapMutation(caller, name, 'unlink google mfa');
		}
		if (!caller.isSA) {
			const code = managerMayMutateTarget(caller, doc.roles ?? []);
			if (!hasShelterScope(doc.roles ?? [], code)) {
				throw new ServiceError(
					'FORBIDDEN',
					'A manager may only unlink MFA for users in their own shelter'
				);
			}
		}
	}

	if (!getGoogleMfa(doc)) {
		return;
	}

	const remaining = (doc.mfa?.providers ?? []).filter((p) => p.type !== 'google');
	const updatedDoc: CouchUserDoc = {
		...doc,
		mfa: remaining.length > 0 ? { providers: remaining } : null
	};

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('unlink google mfa', res.status, res.data);
}

/** Update `verified_at` on the linked Google provider after a successful step-up. */
export async function touchGoogleMfaVerified(name: string): Promise<void> {
	const doc = await readUserDoc(name, 'touch google mfa verified');
	const google = getGoogleMfa(doc);
	if (!google) {
		throw new ServiceError('VALIDATION', 'User is not enrolled in Google MFA');
	}

	const now = new Date().toISOString();
	const providers = (doc.mfa?.providers ?? []).map((p) =>
		p.type === 'google' ? { ...p, verified_at: now } : p
	);
	const updatedDoc: CouchUserDoc = { ...doc, mfa: { providers } };

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) {
		throw serviceErrorFromCouch('touch google mfa verified', res.status, res.data);
	}
}

/**
 * Find the single `_users` doc with a ThaID MFA provider matching `subject`.
 * Returns null when not enrolled / unknown. Uniqueness is enforced at link time.
 */
export async function findUserByThaidSubject(subject: string): Promise<CouchUserDoc | null> {
	const trimmed = subject.trim();
	if (!trimmed) return null;

	const all = await fetchAllUserDocs();
	for (const doc of all) {
		const linked = getThaidMfa(doc);
		if (linked && linked.subject === trimmed) {
			return doc;
		}
	}
	return null;
}

/**
 * Link a ThaID (DOPA BORA) identity as step-up MFA.
 * Enforces one ThaID per user and global uniqueness of `subject`.
 */
export async function linkThaidMfa(
	name: string,
	input: { subject: string; name?: string | null; pid_masked?: string | null }
): Promise<void> {
	const subject = input.subject.trim();
	if (!subject) {
		throw new ServiceError('VALIDATION', 'ThaID subject is required');
	}

	const all = await fetchAllUserDocs();
	for (const other of all) {
		const linked = getThaidMfa(other);
		if (linked && linked.subject === subject && other.name !== name) {
			throw new ServiceError('CONFLICT', 'ThaID account is already linked to another user');
		}
	}

	const doc = await readUserDoc(name, 'link thaid mfa');
	if (getThaidMfa(doc)) {
		throw new ServiceError('CONFLICT', 'User already has a ThaID MFA provider linked');
	}

	const now = new Date().toISOString();
	const provider: MfaProvider = {
		type: 'thaid',
		subject,
		name: input.name ?? null,
		pid_masked: input.pid_masked ?? null,
		linked_at: now,
		verified_at: now
	};

	const updatedDoc: CouchUserDoc = {
		...doc,
		mfa: { providers: [...(doc.mfa?.providers ?? []).filter((p) => p.type !== 'thaid'), provider] }
	};

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('link thaid mfa', res.status, res.data);
}

/** Clear ThaID MFA link. Pass `caller` for admin/manager authz; omit for self-service. */
export async function unlinkThaidMfa(name: string, caller?: Caller): Promise<void> {
	const doc = await readUserDoc(name, 'unlink thaid mfa');

	if (caller) {
		if (isProtectedBootstrapAdmin(doc, bootstrapAdminName())) {
			rejectBootstrapMutation(caller, name, 'unlink thaid mfa');
		}
		if (!caller.isSA) {
			const code = managerMayMutateTarget(caller, doc.roles ?? []);
			if (!hasShelterScope(doc.roles ?? [], code)) {
				throw new ServiceError(
					'FORBIDDEN',
					'A manager may only unlink MFA for users in their own shelter'
				);
			}
		}
	}

	if (!getThaidMfa(doc)) {
		return;
	}

	const remaining = (doc.mfa?.providers ?? []).filter((p) => p.type !== 'thaid');
	const updatedDoc: CouchUserDoc = {
		...doc,
		mfa: remaining.length > 0 ? { providers: remaining } : null
	};

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) throw serviceErrorFromCouch('unlink thaid mfa', res.status, res.data);
}

/** Update `verified_at` on the linked ThaID provider after a successful step-up or login. */
export async function touchThaidMfaVerified(name: string): Promise<void> {
	const doc = await readUserDoc(name, 'touch thaid mfa verified');
	const thaid = getThaidMfa(doc);
	if (!thaid) {
		throw new ServiceError('VALIDATION', 'User is not enrolled in ThaID MFA');
	}

	const now = new Date().toISOString();
	const providers = (doc.mfa?.providers ?? []).map((p) =>
		p.type === 'thaid' ? { ...p, verified_at: now } : p
	);
	const updatedDoc: CouchUserDoc = { ...doc, mfa: { providers } };

	const res = await adminRaw(`/_users/${userDocId(name)}`, 'PUT', updatedDoc);
	if (res.status >= 400) {
		throw serviceErrorFromCouch('touch thaid mfa verified', res.status, res.data);
	}
}
