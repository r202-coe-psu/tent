/**
 * Whether a volunteer already has a system login, and what it may do in the active shelter
 * (#891, #1044). Pure: the UI only renders the result.
 *
 * `accounts` is the shelter's volunteer accounts (`GET /api/v1/volunteer-access/accounts`), which
 * SA / SM / volunteer_coordinator may read. Pass `undefined` while it is unavailable (loading,
 * errored, viewer not allowed): the status then falls back to the profile's `user_name` and
 * leaves the role unknown.
 */
import { roleOptionLabel } from '$lib/auth/roles';

/** One account linked to a volunteer profile, with its roles in the active shelter only. */
export type VolunteerAccount = {
	volunteer_id: string;
	name: string;
	active: boolean;
	/** Coordinator grants here, each ending at `expires_at`. */
	grants: readonly { role: string; expires_at: string }[];
	/** Roles a manager gave here (no expiry). */
	permanent_roles: readonly string[];
	/** Only when it holds nothing here: how its last role here ended (#1044). */
	last_ended?: AccessEnding | null;
};

/** How the account's last role in the shelter ended, from the grant audits. */
export type AccessEnding = {
	role: string;
	reason: 'expired' | 'revoked' | 'verification_revoked';
	/** When it ended (ISO). */
	at: string;
	by: string;
	cause?: string;
};

/** A role the account holds here; `expiresAt` is null for a manager's permanent role. */
export type AccessRole = { role: string; label: string; expiresAt: string | null };

export type VolunteerAccessStatus =
	| { kind: 'none' }
	/** Holds a role here. `roles` is `null` while the accounts are not known yet. */
	| { kind: 'active'; loginName: string; roles: AccessRole[] | null }
	/** Has an account but nothing here any more: the grant expired or was revoked. */
	| { kind: 'lapsed'; loginName: string; lastEnded: AccessEnding | null }
	| { kind: 'deactivated'; loginName: string; roles: AccessRole[] };

export function accountRoles(account: Pick<VolunteerAccount, 'grants' | 'permanent_roles'>) {
	return [
		...account.permanent_roles.map((role) => ({
			role,
			label: roleOptionLabel(role),
			expiresAt: null
		})),
		...account.grants.map((g) => ({
			role: g.role,
			label: roleOptionLabel(g.role),
			expiresAt: g.expires_at
		}))
	] satisfies AccessRole[];
}

export function volunteerAccessStatus(
	volunteer: { _id: string; user_name?: string | null },
	accounts: readonly VolunteerAccount[] | undefined
): VolunteerAccessStatus {
	if (!accounts) {
		const loginName = volunteer.user_name?.trim();
		return loginName ? { kind: 'active', loginName, roles: null } : { kind: 'none' };
	}
	const account = accounts.find((a) => a.volunteer_id === volunteer._id);
	if (!account) return { kind: 'none' };
	const roles = accountRoles(account);
	if (!account.active) return { kind: 'deactivated', loginName: account.name, roles };
	return roles.length > 0
		? { kind: 'active', loginName: account.name, roles }
		: { kind: 'lapsed', loginName: account.name, lastEnded: account.last_ended ?? null };
}

export function hasVolunteerAccount(status: VolunteerAccessStatus): boolean {
	return status.kind !== 'none';
}

/**
 * What closing the profile does to the account's access here (CR-221 FR-20): coordinator grants
 * are revoked by the worker sweep, a role a shelter manager gave (no expiry) is not touched and
 * only the manager can take it back. Roles unknown (`null`) or no account: nothing to say.
 */
export function closeProfileAccessNotice(status: VolunteerAccessStatus): {
	revokesGrants: boolean;
	keepsManagerRole: boolean;
} {
	const roles =
		status.kind === 'active' || status.kind === 'deactivated' ? (status.roles ?? []) : [];
	return {
		revokesGrants: roles.some((r) => r.expiresAt !== null),
		keepsManagerRole: roles.some((r) => r.expiresAt === null)
	};
}

/**
 * How an account's role here ended, split for display (#1044): the role it had ("เคยเป็น …",
 * null when the audit does not say) and how it ended ("หมดอายุ", "ถูกถอน…"). Null without one.
 */
export function accessEndingParts(
	ending: AccessEnding | null | undefined
): { role: string | null; how: string } | null {
	if (!ending) return null;
	const how =
		ending.reason === 'expired'
			? 'หมดอายุ'
			: ending.reason === 'verification_revoked'
				? 'ถูกถอนเพราะผลยืนยันตัวตนถูกยกเลิก'
				: ending.cause === 'profile_inactive'
					? 'ถูกถอนเพราะปิดโปรไฟล์'
					: 'ถูกถอน';
	return { role: ending.role ? `เคยเป็น ${roleOptionLabel(ending.role)}` : null, how };
}
