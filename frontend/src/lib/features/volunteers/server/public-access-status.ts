import { roleOptionLabel } from '$lib/auth/roles';
import type {
	PortalAccessStatus,
	PortalAccessStatusCode,
	PortalCredential
} from '$lib/features/volunteer-portal/server';
import { findAsPublicWriter } from '$lib/server/couch-public-writer';
import {
	readShelterVolunteerAccounts,
	type ShelterVolunteerAccount
} from '$lib/server/user-service';
import { PublicScheduleError, resolveIdentities } from './public-schedule-action';
import { lastGrantEndings, type GrantEnding } from './volunteer-access-grant';
import type { ResolvedIdentity } from './public-schedule-action';

/**
 * The portal's "สิทธิ์ใช้งานระบบ" card (CR-221 FR-26 to FR-28): per shelter where the credential
 * opens a volunteer profile, whether the volunteer has staff-system access there.
 *
 * Anyone who knows a phone number can call this, so a row carries the status, the role label and
 * one date and nothing else (FR-28) — never the username (an email), the issuer or any other field
 * of the account. A suspended account answers exactly like "no account" (Amendment A2): a caller
 * who only knows the number must not learn that an admin suspended it.
 */

const STATUS_RANK: Record<PortalAccessStatusCode, number> = {
	active: 2,
	lapsed: 1,
	none: 0
};

type Standing = Pick<PortalAccessStatus, 'status' | 'role_label' | 'expires_at'>;

type Grant = ShelterVolunteerAccount['grants'][number];

const NO_ACCESS: Standing = { status: 'none', role_label: null, expires_at: null };

const endsLater = (a: Grant, b: Grant) => Date.parse(a.expires_at) > Date.parse(b.expires_at);

/**
 * One account's standing in the shelter at `now`.
 *
 * - A suspended account (`_users.active === false`) is `none`, whatever roles it still holds.
 * - A grant whose `expires_at` has passed does not count, even if the worker has not swept it yet:
 *   the account is then `lapsed`, dated by that grant.
 * - Several roles: a permanent role (given by the shelter manager) wins over any grant, the first
 *   by role code when there are several; among live grants the one ending last wins.
 * - `lapsed` without a grant left on the doc has no date yet; the caller fills it from the audit.
 */
export function accountStanding(account: ShelterVolunteerAccount, now: number): Standing {
	if (!account.active) return NO_ACCESS;
	const [permanent] = [...account.permanent_roles].sort();
	if (permanent) {
		return { status: 'active', role_label: roleOptionLabel(permanent), expires_at: null };
	}
	const live = account.grants.filter((grant) => Date.parse(grant.expires_at) > now);
	const latestLive = live.reduce<Grant | null>(
		(best, grant) => (best === null || endsLater(grant, best) ? grant : best),
		null
	);
	if (latestLive) {
		return {
			status: 'active',
			role_label: roleOptionLabel(latestLive.role),
			expires_at: latestLive.expires_at
		};
	}
	const latestEnded = account.grants.reduce<Grant | null>(
		(best, grant) => (best === null || endsLater(grant, best) ? grant : best),
		null
	);
	return { status: 'lapsed', role_label: null, expires_at: latestEnded?.expires_at ?? null };
}

async function shelterStatus(identity: ResolvedIdentity, now: number): Promise<PortalAccessStatus> {
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
	// volunteer account whose `volunteer_id` is this profile. `narrow`: this path is anonymous, so
	// read only the fields the standing needs, never a password hash or salt.
	const accounts = await readShelterVolunteerAccounts(links, ref.code, { narrow: true });
	const standings = accounts.map((account) => ({
		account,
		standing: accountStanding(account, now)
	}));

	// A lapsed account with no grant left on its doc says since when from the grant-ending audit,
	// in `expires_at`: no new field, and still no account name (FR-28). One audit read per shelter.
	const undated = standings
		.filter(({ standing }) => standing.status === 'lapsed' && standing.expires_at === null)
		.map(({ account }) => account.name);
	// A failed audit read costs the date, not the card: the row then says "ended" with no date.
	const endings = await lastGrantEndings(ref.code, undated).catch((error: unknown) => {
		console.error('[public-access-status] grant audits not read; end date left empty', {
			shelter_code: ref.code,
			error
		});
		return new Map<string, GrantEnding>();
	});

	const standing = standings
		.map(({ account, standing }) =>
			standing.status === 'lapsed' && standing.expires_at === null
				? { ...standing, expires_at: endings.get(account.name)?.at ?? null }
				: standing
		)
		.reduce<Standing>(
			(best, next) => (STATUS_RANK[next.status] > STATUS_RANK[best.status] ? next : best),
			NO_ACCESS
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
	credential: PortalCredential,
	now: number = Date.now()
): Promise<{ success: true; access: PortalAccessStatus[] }> {
	const identities = await resolveIdentities(credential);
	const access: PortalAccessStatus[] = [];
	for (const identity of identities) {
		try {
			access.push(await shelterStatus(identity, now));
		} catch {
			throw new PublicScheduleError('ACCESS_STATUS_UNAVAILABLE', 503);
		}
	}
	access.sort((a, b) => a.shelter_code.localeCompare(b.shelter_code));
	return { success: true, access };
}
