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
};

/** A role the account holds here; `expiresAt` is null for a manager's permanent role. */
export type AccessRole = { role: string; label: string; expiresAt: string | null };

export type VolunteerAccessStatus =
	| { kind: 'none' }
	/** Holds a role here. `roles` is `null` while the accounts are not known yet. */
	| { kind: 'active'; loginName: string; roles: AccessRole[] | null }
	/** Has an account but nothing here any more: the grant expired or was revoked. */
	| { kind: 'lapsed'; loginName: string }
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
		: { kind: 'lapsed', loginName: account.name };
}

export function hasVolunteerAccount(status: VolunteerAccessStatus): boolean {
	return status.kind !== 'none';
}
