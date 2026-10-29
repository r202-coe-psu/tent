import { sha256Hex } from '$lib/db/hash';
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
	readVolunteerGrants,
	revokeCoordinatorGrant
} from '$lib/server/user-service';
import { normalizePhone } from '../domain/phone';
import { identityVerificationStatus } from '../domain/verification';
import { shelterRefs } from './public-schedule-action';

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
	phone_hash?: string | null;
	national_id?: string | null;
	national_id_hash?: string | null;
	organization?: string | null;
	user_name?: string | null;
	identity_verified?: boolean;
	identity_verification?: { status?: string; reviewed_by?: string | null } | null;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** A mobile (10 digits) or a landline (9 digits): what `_users.phone` accepts as contact. */
const CONTACT_PHONE_RE = /^0\d{8,9}$/;

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
const verificationOf = (
	doc: VolunteerDoc,
	shelterCode: string = doc.shelter_code as string
): NonNullable<RoleGrant['verified_by']> => ({
	shelter_code: shelterCode,
	volunteer_id: doc._id,
	reviewed_by: doc.identity_verification?.reviewed_by ?? null
});

const isVerified = (doc: VolunteerDoc): boolean =>
	identityVerificationStatus({
		identity_verified: doc.identity_verified === true,
		identity_verification: doc.identity_verification as never
	}) === 'verified';

/**
 * The profile that proves the volunteer's identity, or `null`: this shelter's own verified
 * profile, else another shelter's verified profile with the same `phone_hash` AND
 * `national_id_hash` (draft-coordinator-limited-access-grant FR-3). A phone alone is not enough
 * to lend another shelter's verification, and a profile without a national ID counts only here.
 */
async function identityVerifiedBy(
	volunteer: VolunteerDoc
): Promise<NonNullable<RoleGrant['verified_by']> | null> {
	if (isVerified(volunteer)) return verificationOf(volunteer);
	const phone = volunteer.phone ? normalizePhone(volunteer.phone) : '';
	const nationalIdHash =
		volunteer.national_id_hash ||
		(volunteer.national_id ? await sha256Hex(volunteer.national_id) : '');
	if (!phone || !nationalIdHash) return null;
	const phoneHash = await sha256Hex(phone);
	for (const ref of await shelterRefs()) {
		if (ref.code === volunteer.shelter_code) continue;
		const res = await adminRaw(`/${ref.dbName}/_find`, 'POST', {
			selector: { type: 'volunteer', phone_hash: phoneHash, national_id_hash: nationalIdHash },
			limit: 20
		});
		if (res.status === 404) continue;
		if (res.status >= 400)
			throw serviceErrorFromCouch('find volunteer profiles', res.status, res.data);
		const docs = (res.data as { docs?: VolunteerDoc[] } | null)?.docs ?? [];
		const match = docs.find(isVerified);
		if (match) return verificationOf(match, ref.code);
	}
	return null;
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

/**
 * A `volunteer_coordinator` gives a volunteer system access (#955, #879 item 2). Every rule is
 * enforced here, not in the UI: own shelter only (from the session), four roles, identity
 * verified (here, or in another shelter by phone and national ID), and a required expiry within
 * 7 days. Authorization runs first; the existing-account rules run in `grantCoordinatorRole`.
 */
export async function grantVolunteerAccessAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: CoordinatorGrantInput,
	now: Date = new Date()
): Promise<{ created: boolean; unchanged: boolean }> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);

	const role = input.role;
	if (!isCoordinatorGrantableRole(role)) {
		throw new ServiceError('FORBIDDEN', 'A coordinator may only grant a desk staff role');
	}
	const expiryError = grantExpiryError(input.expires_on, now);
	if (expiryError) throw new ServiceError('VALIDATION', expiryError);
	const email = asString(input.email);
	if (!EMAIL_RE.test(email)) throw new ServiceError('VALIDATION', 'กรุณากรอกอีเมลให้ถูกต้อง');
	const password = typeof input.password === 'string' ? input.password : '';
	const volunteerId = asString(input.volunteer_id);
	if (!volunteerId) throw new ServiceError('VALIDATION', 'volunteer_id is required');

	const volunteer = await readVolunteer(shelterCode, volunteerId);
	const verifiedBy = await identityVerifiedBy(volunteer);
	if (!verifiedBy) {
		throw new ServiceError('VALIDATION', 'อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้');
	}

	const phone = volunteer.phone ? normalizePhone(volunteer.phone) : '';
	const grant: RoleGrant = {
		shelter_code: shelterCode,
		role,
		expires_at: grantExpiresAt(input.expires_on as string),
		granted_by: caller.name,
		granted_at: now.toISOString(),
		verified_by: verifiedBy
	};
	return grantCoordinatorRole({
		name: email,
		password,
		display_name: `${volunteer.first_name ?? ''} ${volunteer.last_name ?? ''}`.trim() || email,
		organization: volunteer.organization ?? null,
		phone: CONTACT_PHONE_RE.test(phone) ? phone : null,
		volunteer_id: volunteerId,
		linked_user_name: volunteer.user_name ?? null,
		grant
	});
}

/**
 * A coordinator takes back a grant they issued (FR-8). Same caller scope as the grant; the
 * account is named like the grant names it (`email` + `volunteer_id`). Only a grant the caller
 * issued can go: anything else is 403 and nothing is written.
 */
export async function revokeVolunteerAccessAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: CoordinatorRevokeInput
): Promise<void> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);
	const role = input.role;
	if (!isCoordinatorGrantableRole(role)) {
		throw new ServiceError('FORBIDDEN', 'A coordinator may only revoke a desk staff role');
	}
	const email = asString(input.email);
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

/** A grant as the coordinator dialog shows it: `mine` grants are the ones the caller may revoke. */
export type VolunteerGrantView = { role: string; expires_at: string; mine: boolean };

/**
 * The grants on the account linked to a volunteer of the coordinator's shelter (FR-8), so the
 * dialog can offer to revoke the caller's own. The account is the profile's `user_name`, read
 * server-side, so no other account can be probed.
 */
export async function listVolunteerGrantsAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: Pick<CoordinatorGrantInput, 'shelter_code' | 'volunteer_id'>
): Promise<{ email: string | null; grants: VolunteerGrantView[] }> {
	const shelterCode = coordinatorShelter(caller, input.shelter_code);
	const volunteerId = asString(input.volunteer_id);
	if (!volunteerId) throw new ServiceError('VALIDATION', 'volunteer_id is required');
	const volunteer = await readVolunteer(shelterCode, volunteerId);
	const email = volunteer.user_name ?? null;
	if (!email) return { email: null, grants: [] };
	const grants = await readVolunteerGrants({
		name: email,
		volunteer_id: volunteerId,
		shelter_code: shelterCode
	});
	return {
		email,
		grants: grants.map((g) => ({
			role: g.role,
			expires_at: g.expires_at,
			mine: g.granted_by === caller.name
		}))
	};
}
