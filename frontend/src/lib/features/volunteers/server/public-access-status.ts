import { roleOptionLabel } from '$lib/auth/roles';
import type {
	PortalAccessStatus,
	PortalAccessStatusCode,
	PortalCredential
} from '$lib/features/volunteer-portal/domain/volunteer';
import { findAsPublicWriter } from '$lib/server/couch-public-writer';
import {
	readShelterVolunteerAccounts,
	type ShelterVolunteerAccount
} from '$lib/server/user-service';
import { PublicScheduleError, resolveIdentities } from './public-schedule-action';
import type { ResolvedIdentity } from './public-schedule-action';

/**
 * The portal's "สิทธิ์ใช้งานระบบ" card (CR-221 FR-26 to FR-28): per shelter where the credential
 * opens a volunteer profile, whether the volunteer has staff-system access there.
 *
 * Anyone who knows a phone number can call this, so a row carries the status, the role label and
 * the end date and nothing else (FR-28) — never the username (an email), the issuer or any
 * other field of the account.
 */

const STATUS_RANK: Record<PortalAccessStatusCode, number> = {
	active: 3,
	account_disabled: 2,
	lapsed: 1,
	none: 0
};

type Standing = Pick<PortalAccessStatus, 'status' | 'role_label' | 'expires_at'>;

/**
 * One account's standing in the shelter. A suspended account (`_users.active === false`) is
 * `account_disabled` whatever roles it still holds. Several roles: a permanent role (given by the
 * shelter manager) wins over any grant; among grants the one ending last wins.
 */
function accountStanding(account: ShelterVolunteerAccount): Standing {
	if (!account.active) return { status: 'account_disabled', role_label: null, expires_at: null };
	const [permanent] = account.permanent_roles;
	if (permanent) {
		return { status: 'active', role_label: roleOptionLabel(permanent), expires_at: null };
	}
	const latest = account.grants.reduce<ShelterVolunteerAccount['grants'][number] | null>(
		(best, grant) =>
			best === null || Date.parse(grant.expires_at) > Date.parse(best.expires_at) ? grant : best,
		null
	);
	if (latest) {
		return {
			status: 'active',
			role_label: roleOptionLabel(latest.role),
			expires_at: latest.expires_at
		};
	}
	return { status: 'lapsed', role_label: null, expires_at: null };
}

async function shelterStatus(identity: ResolvedIdentity): Promise<PortalAccessStatus> {
	const { ref } = identity;
	const result = await findAsPublicWriter(
		ref.dbName,
		{ type: 'volunteer', _id: { $in: [...identity.volunteerIds] } },
		{ limit: 100, fields: ['_id', 'user_name'] }
	);
	const docs = (result.data as { docs?: { _id?: unknown; user_name?: unknown }[] } | null)?.docs;
	const links = (Array.isArray(docs) ? docs : []).flatMap((doc) =>
		typeof doc._id === 'string' && typeof doc.user_name === 'string' && doc.user_name.trim()
			? [{ volunteer_id: doc._id, name: doc.user_name.trim() }]
			: []
	);
	// `readShelterVolunteerAccounts` enforces the two-way link (FR-7): the account must be a
	// volunteer account whose `volunteer_id` is this profile.
	const accounts = await readShelterVolunteerAccounts(links, ref.code);
	const standing = accounts
		.map(accountStanding)
		.reduce<Standing>(
			(best, next) => (STATUS_RANK[next.status] > STATUS_RANK[best.status] ? next : best),
			{ status: 'none', role_label: null, expires_at: null }
		);
	return {
		shelter_code: ref.code,
		shelter_name: ref.name,
		status: standing.status,
		role_label: standing.role_label,
		expires_at: standing.expires_at
	};
}

/**
 * Same credential and same profiles as the schedule read (`resolveIdentities`), so signing in by
 * phone or by ticket token shows the same card. A credential that opens no profile answers an
 * empty list, as the schedule does.
 */
export async function readPublicAccessStatus(
	credential: PortalCredential
): Promise<{ success: true; access: PortalAccessStatus[] }> {
	const identities = await resolveIdentities(credential);
	const access: PortalAccessStatus[] = [];
	for (const identity of identities) {
		try {
			access.push(await shelterStatus(identity));
		} catch {
			throw new PublicScheduleError('ACCESS_STATUS_UNAVAILABLE', 503);
		}
	}
	access.sort((a, b) => a.shelter_code.localeCompare(b.shelter_code));
	return { success: true, access };
}
