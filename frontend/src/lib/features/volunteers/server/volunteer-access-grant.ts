import { sha256Hex } from '$lib/db/hash';
import { VOLUNTEER_COORDINATOR, hasStaffCapability, shelterScopeRole } from '$lib/auth/roles';
import {
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
import { grantCoordinatorRole } from '$lib/server/user-service';
import { normalizePhone } from '../domain/phone';
import { identityVerificationStatus } from '../domain/verification';
import { shelterRefs } from './public-schedule-action';

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
	organization?: string | null;
	user_name?: string | null;
	identity_verified?: boolean;
	identity_verification?: { status?: string } | null;
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

const isVerified = (doc: VolunteerDoc): boolean =>
	identityVerificationStatus({
		identity_verified: doc.identity_verified === true,
		identity_verification: doc.identity_verification as never
	}) === 'verified';

/**
 * Identity is verified in this shelter, or in another shelter's profile with the same phone
 * (`phone_hash`, the lookup `resolveIdentities` uses; #886). No phone: this shelter only.
 */
async function identityVerified(volunteer: VolunteerDoc): Promise<boolean> {
	if (isVerified(volunteer)) return true;
	const phone = volunteer.phone ? normalizePhone(volunteer.phone) : '';
	if (!phone) return false;
	const phoneHash = await sha256Hex(phone);
	for (const ref of await shelterRefs()) {
		if (ref.code === volunteer.shelter_code) continue;
		const res = await adminRaw(`/${ref.dbName}/_find`, 'POST', {
			selector: { type: 'volunteer', phone_hash: phoneHash },
			limit: 20
		});
		if (res.status === 404) continue;
		if (res.status >= 400)
			throw serviceErrorFromCouch('find volunteer profiles', res.status, res.data);
		const docs = (res.data as { docs?: VolunteerDoc[] } | null)?.docs ?? [];
		if (docs.some(isVerified)) return true;
	}
	return false;
}

/**
 * A `volunteer_coordinator` gives a volunteer system access (#955, #879 item 2). Every rule is
 * enforced here, not in the UI: own shelter only, four roles, identity verified (here or in
 * another shelter by phone), and a required expiry within 7 days. Authorization runs first.
 */
export async function grantVolunteerAccessAsCoordinator(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: CoordinatorGrantInput,
	now: Date = new Date()
): Promise<{ created: boolean; unchanged: boolean }> {
	const shelterCode = asString(input.shelter_code);
	const isCoordinatorHere =
		shelterCode !== '' &&
		caller.roles.includes(shelterScopeRole(shelterCode)) &&
		hasStaffCapability(caller.roles, VOLUNTEER_COORDINATOR, shelterCode);
	if (!isCoordinatorHere) {
		throw new ServiceError('FORBIDDEN', 'Requires volunteer_coordinator in this shelter');
	}

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
	if (!(await identityVerified(volunteer))) {
		throw new ServiceError('FORBIDDEN', 'อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้');
	}

	const phone = volunteer.phone ? normalizePhone(volunteer.phone) : '';
	const grant: RoleGrant = {
		shelter_code: shelterCode,
		role,
		expires_at: grantExpiresAt(input.expires_on as string),
		granted_by: caller.name,
		granted_at: now.toISOString()
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
