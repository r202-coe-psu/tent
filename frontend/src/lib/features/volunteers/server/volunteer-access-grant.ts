import {
	coordinatorShelterCodes,
	grantExpiresAt,
	grantExpiryError,
	isCoordinatorGrantableRole,
	type RoleGrant
} from '$lib/auth/role-grants';
import {
	ServiceError,
	adminRaw,
	serviceErrorFromCouch,
	type Caller
} from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import {
	grantCoordinatorRole,
	readShelterVolunteerAccounts,
	readVolunteerAccount,
	revokeCoordinatorGrant,
	type ShelterVolunteerAccount
} from '$lib/server/user-service';
import { canAccessVolunteerBackoffice } from '$lib/auth/roles';
import { normalizeThaiPhone } from '$lib/db/model';
import { isVolunteerMobile } from '../domain/phone';
import { identityVerificationStatus } from '../domain/verification';

/** What the coordinator sends to take a grant back. */
export type CoordinatorRevokeInput = Pick<
	CoordinatorGrantInput,
	'shelter_code' | 'volunteer_id' | 'email' | 'role'
>;

/** What the coordinator sends: everything else is read server-side. */
export type CoordinatorGrantInput = {
	shelter_code: unknown;
	volunteer_id: unknown;
	email: unknown;
	password: unknown;
	role: unknown;
	/** `YYYY-MM-DD`, Asia/Bangkok. Required: there is no default. */
	expires_on: unknown;
};

type VolunteerDoc = {
	_id: string;
	type?: string;
	shelter_code?: string;
	first_name?: string;
	last_name?: string;
	phone?: string | null;
	status?: string;
	phone_hash?: string | null;
	national_id?: string | null;
	national_id_hash?: string | null;
	organization?: string | null;
	user_name?: string | null;
	identity_verified?: boolean;
	identity_verification?: { status?: string; reviewed_by?: string | null } | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

async function readVolunteer(shelterCode: string, volunteerId: string): Promise<VolunteerDoc> {
	const res = await adminRaw(
		`/${shelterDbName(shelterCode)}/${encodeURIComponent(volunteerId)}`,
		'GET'
	);
	if (res.status >= 400 && res.status !== 404) {
		throw serviceErrorFromCouch('read volunteer', res.status, res.data);
	}
	const doc = res.data as VolunteerDoc | null;
	if (res.status === 404 || !doc || doc.type !== 'volunteer' || doc.shelter_code !== shelterCode) {
		throw new ServiceError('VALIDATION', 'ไม่พบข้อมูลอาสาสมัครในศูนย์นี้');
	}
	return doc;
}

/** Where the verification lives and who marked it verified (`reviewed_by`, null when unknown). */
const verificationOf = (doc: VolunteerDoc): NonNullable<RoleGrant['verified_by']> => ({
	shelter_code: doc.shelter_code as string,
	volunteer_id: doc._id,
	reviewed_by: doc.identity_verification?.reviewed_by ?? null
});

const isVerified = (doc: VolunteerDoc): boolean =>
	identityVerificationStatus({
		identity_verified: doc.identity_verified === true,
		identity_verification: doc.identity_verification as never
	}) === 'verified';

const UNVERIFIED_MESSAGE = 'อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้';

/**
 * A system account is created for a volunteer profile only once the profile is identity-verified
 * in the shelter(s) whose roles the account is given (CR-221 FR-3, every grantor): the SA / SM
 * path (`POST /api/v1/users` with `volunteer_id`) checks it here, as the UI's check alone is not a
 * rule. Another shelter's check does not stand in; a profile missing from a shelter is 422 too.
 * 422 and nothing written otherwise.
 */
export async function assertVolunteerVerifiedForAccess(
	shelterCodes: readonly string[],
	volunteerId: string
): Promise<void> {
	for (const shelterCode of shelterCodes) {
		const volunteer = await readVolunteer(shelterCode, volunteerId);
		if (!isVerified(volunteer)) throw new ServiceError('VALIDATION', UNVERIFIED_MESSAGE);
	}
}

/**
 * The shelter a coordinator acts in, read from their session roles (`capabilitiesForShelter`,
 * compound or legacy flat), never trusted from the body (FR-1). A body shelter the caller holds no
 * coordinator scope for is 403; a caller with several shelters must name one.
 */
function coordinatorShelter(caller: Pick<Caller, 'roles'>, requested: unknown): string {
	const owned = coordinatorShelterCodes(caller.roles);
	if (owned.length === 0) {
		throw new ServiceError('FORBIDDEN', 'Requires volunteer_coordinator in a shelter');
	}
	const code = asString(requested);
	if (code === '') {
		if (owned.length === 1) return owned[0];
		throw new ServiceError('VALIDATION', 'shelter_code is required');
	}
	if (!owned.includes(code)) {
		throw new ServiceError('FORBIDDEN', 'Requires volunteer_coordinator in this shelter');
	}
	return code;
}

/** The volunteer's own account already holds a coordinator grant in this shelter. */
async function holdsGrantHere(
	shelterCode: string,
	volunteer: VolunteerDoc,
	email: string
): Promise<boolean> {
	const account = await readVolunteerAccount({
		name: volunteer.user_name || email,
		volunteer_id: volunteer._id,
		shelter_code: shelterCode
	});
	return account.exists && account.grants.length > 0;
}

/**
 * A `volunteer_coordinator` gives a volunteer system access (#955, #879 item 2). Every rule is
 * enforced here, not in the UI: own shelter only (from the session), the coordinator roles (`COORDINATOR_GRANTABLE_CAPABILITIES`), identity
 * verified in this shelter, and a required expiry within
 * 7 days. Authorization runs first; the existing-account rules run in `grantCoordinatorRole`.
 */
export async function grantVolunteerAccessAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: CoordinatorGrantInput,
	now: Date = new Date()
): Promise<{ created: boolean; unchanged: boolean; name: string }> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);

	const role = input.role;
	if (!isCoordinatorGrantableRole(role)) {
		throw new ServiceError('FORBIDDEN', 'A coordinator may not grant this role');
	}
	const expiryError = grantExpiryError(input.expires_on, now);
	if (expiryError) throw new ServiceError('VALIDATION', expiryError);
	const email = asString(input.email).toLowerCase();
	if (!EMAIL_RE.test(email)) throw new ServiceError('VALIDATION', 'กรุณากรอกอีเมลให้ถูกต้อง');
	const password = typeof input.password === 'string' ? input.password : '';
	const volunteerId = asString(input.volunteer_id);
	if (!volunteerId) throw new ServiceError('VALIDATION', 'volunteer_id is required');

	const volunteer = await readVolunteer(shelterCode, volunteerId);
	// A closed profile is reopened first (CR-221 FR-21); 422 is `VALIDATION` in this service.
	if (volunteer.status === 'inactive') {
		throw new ServiceError('VALIDATION', 'เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้');
	}
	// Verified in this shelter only (CR FR-3, #1044): another shelter's check does not stand in.
	// Editing a grant the account already holds here needs no new check (FR-3, last line); a new
	// grant, or a re-grant on a lapsed account, does.
	const verified = isVerified(volunteer);
	if (!verified && !(await holdsGrantHere(shelterCode, volunteer, email))) {
		throw new ServiceError('VALIDATION', UNVERIFIED_MESSAGE);
	}
	const verifiedBy = verified ? verificationOf(volunteer) : undefined;

	const phone = volunteer.phone ? normalizeThaiPhone(volunteer.phone) : '';
	// CR-210 FR-8: a filled phone must be a 10-digit mobile before access is issued.
	if (phone && !isVolunteerMobile(phone)) {
		throw new ServiceError(
			'VALIDATION',
			'เบอร์โทรศัพท์ในโปรไฟล์ไม่ใช่มือถือ 10 หลัก กรุณาแก้เบอร์ในโปรไฟล์ก่อนออกสิทธิ์'
		);
	}
	const grant: RoleGrant = {
		shelter_code: shelterCode,
		role,
		expires_at: grantExpiresAt(input.expires_on as string),
		granted_by: caller.name,
		granted_at: now.toISOString(),
		...(verifiedBy ? { verified_by: verifiedBy } : {})
	};
	return grantCoordinatorRole({
		name: email,
		password,
		display_name: `${volunteer.first_name ?? ''} ${volunteer.last_name ?? ''}`.trim() || email,
		organization: volunteer.organization ?? null,
		phone: phone || null,
		volunteer_id: volunteerId,
		linked_user_name: volunteer.user_name ?? null,
		grant
	});
}

/**
 * A coordinator takes back a coordinator grant in their shelter (CR-221 FR-17), whoever issued it.
 * Same caller scope as the grant; the account is named like the grant names it (`email` +
 * `volunteer_id`). A role a manager gave (no grant) is 403 and nothing is written.
 */
export async function revokeVolunteerAccessAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: CoordinatorRevokeInput
): Promise<void> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);
	const role = input.role;
	if (!isCoordinatorGrantableRole(role)) {
		throw new ServiceError('FORBIDDEN', 'A coordinator may not revoke this role');
	}
	const email = asString(input.email).toLowerCase();
	const volunteerId = asString(input.volunteer_id);
	if (!email || !volunteerId) {
		throw new ServiceError('VALIDATION', 'email and volunteer_id are required');
	}
	await revokeCoordinatorGrant({
		name: email,
		volunteer_id: volunteerId,
		shelter_code: shelterCode,
		role,
		actor: caller.name
	});
}

/**
 * A grant as the coordinator dialog shows it; `mine` (issued by the caller) is display-only
 * (FR-17). `granted_by` is the original issuer, shown as "ออกโดย …" beside the old expiry (FR-13).
 */
export type VolunteerGrantView = {
	role: string;
	expires_at: string;
	granted_by: string;
	mine: boolean;
};

/** How the volunteer's last grant in this shelter ended, for "หมดอายุ" vs "ถูกถอน" (#1044). */
export type GrantEnding = {
	role: string;
	reason: 'expired' | 'revoked' | 'verification_revoked';
	at: string;
	/** Who took it back; `worker` for an expiry or a lapsed verification. */
	by: string;
};

export type VolunteerAccessView = {
	email: string | null;
	/** The linked account exists (a profile may keep a `user_name` whose account was removed). */
	has_account: boolean;
	grants: VolunteerGrantView[];
	/** Roles a manager gave in this shelter (no expiry); the coordinator cannot change them. */
	permanent_roles: string[];
	last_ended: GrantEnding | null;
};

const ENDING_REASONS = {
	'role_grant.expired': 'expired',
	'role_grant.revoked': 'revoked',
	'role_grant.verification_revoked': 'verification_revoked'
} as const;

/** The newest grant-ending audit for this account in this shelter (FR-14 audits), or null. */
async function lastGrantEnding(shelterCode: string, name: string): Promise<GrantEnding | null> {
	const res = await adminRaw(`/${shelterDbName(shelterCode)}/_find`, 'POST', {
		selector: {
			type: 'audit',
			target_id: `org.couchdb.user:${name}`,
			reason: { $in: Object.keys(ENDING_REASONS) }
		},
		fields: ['reason', 'created_at', 'context'],
		limit: 200
	});
	if (res.status === 404) return null;
	if (res.status >= 400) throw serviceErrorFromCouch('find grant audits', res.status, res.data);
	const docs = ((res.data as { docs?: unknown[] } | null)?.docs ?? []) as {
		reason: keyof typeof ENDING_REASONS;
		created_at: string;
		context?: { role?: string; actor?: string };
	}[];
	const latest = docs.sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
	if (!latest) return null;
	return {
		role: latest.context?.role ?? '',
		reason: ENDING_REASONS[latest.reason],
		at: latest.created_at,
		by: latest.context?.actor ?? ''
	};
}

/**
 * The account behind a volunteer profile, as the coordinator dialog shows it (FR-8, #1044): its
 * grants here (`mine` = the caller's), roles a manager gave here, and — when it holds nothing
 * here — how the last grant ended.
 */
export async function listVolunteerGrantsAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: Pick<CoordinatorGrantInput, 'shelter_code' | 'volunteer_id'>
): Promise<VolunteerAccessView> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);
	const volunteerId = asString(input.volunteer_id);
	if (!volunteerId) throw new ServiceError('VALIDATION', 'volunteer_id is required');
	const volunteer = await readVolunteer(shelterCode, volunteerId);
	const email = volunteer.user_name ?? null;
	const empty = { has_account: false, grants: [], permanent_roles: [], last_ended: null };
	if (!email) return { email: null, ...empty };
	const account = await readVolunteerAccount({
		name: email,
		volunteer_id: volunteerId,
		shelter_code: shelterCode
	});
	if (!account.exists) return { email, ...empty };
	const holdsRole = account.grants.length > 0 || account.permanent_roles.length > 0;
	return {
		email,
		has_account: true,
		grants: account.grants.map((g) => ({
			role: g.role,
			expires_at: g.expires_at,
			granted_by: g.granted_by,
			mine: g.granted_by === caller.name
		})),
		permanent_roles: account.permanent_roles,
		last_ended: holdsRole ? null : await lastGrantEnding(shelterCode, email)
	};
}

/**
 * Every volunteer account of a shelter with its roles there (#1044), so the people tab and a
 * job's applicants show what each volunteer may do now — the coordinator included, who cannot
 * read the users list. Open to whoever runs that shelter's volunteers (SA / SM / coordinator).
 */
export async function listShelterVolunteerAccounts(
	caller: Pick<Caller, 'roles'>,
	input: { shelter_code: unknown }
): Promise<ShelterVolunteerAccount[]> {
	const shelterCode = asString(input.shelter_code);
	if (!shelterCode) throw new ServiceError('VALIDATION', 'shelter_code is required');
	if (!canAccessVolunteerBackoffice(caller.roles, shelterCode)) {
		throw new ServiceError('FORBIDDEN', 'Requires volunteer back-office access in this shelter');
	}
	const res = await adminRaw(`/${shelterDbName(shelterCode)}/_find`, 'POST', {
		selector: { type: 'volunteer', shelter_code: shelterCode, user_name: { $type: 'string' } },
		fields: ['_id', 'user_name'],
		limit: 10000
	});
	if (res.status === 404) return [];
	if (res.status >= 400) throw serviceErrorFromCouch('find volunteers', res.status, res.data);
	const docs = ((res.data as { docs?: unknown[] } | null)?.docs ?? []) as VolunteerDoc[];
	return readShelterVolunteerAccounts(
		docs.flatMap((doc) =>
			doc.user_name?.trim() ? [{ volunteer_id: doc._id, name: doc.user_name.trim() }] : []
		),
		shelterCode
	);
}
