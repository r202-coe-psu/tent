/**
 * Whether a volunteer already has a system login, and what it may do in the
 * active shelter (#891). Pure: the UI only renders the result.
 *
 * `accounts` is the `useUsers()` list, which only SA / shelter managers may
 * fetch. Pass `undefined` when it is unavailable (viewer not allowed, still
 * loading, errored): the status then falls back to the volunteer profile's
 * `user_name` and never reveals the role.
 */
import { capabilitiesForShelter, roleOptionLabel } from '$lib/auth/roles';

/** The slice of a `_users` account (`UserSummary`) this logic reads. */
export type AccessAccount = {
	name: string;
	roles: readonly string[];
	volunteer_id?: string | null;
	active?: boolean;
};

export type VolunteerAccessStatus =
	| { kind: 'none' }
	| {
			kind: 'linked';
			/** Login username/email. */
			loginName: string;
			/** Thai capability labels in the active shelter; `null` = not visible to this viewer. */
			roleLabels: string[] | null;
	  }
	| { kind: 'deactivated'; loginName: string; roleLabels: string[] | null };

export function volunteerAccessStatus(
	volunteer: { _id: string; user_name?: string | null },
	accounts: readonly AccessAccount[] | undefined,
	shelterCode: string | null | undefined
): VolunteerAccessStatus {
	if (!accounts) {
		const loginName = volunteer.user_name?.trim();
		return loginName ? { kind: 'linked', loginName, roleLabels: null } : { kind: 'none' };
	}

	const account =
		accounts.find((a) => a.volunteer_id === volunteer._id) ??
		(volunteer.user_name ? accounts.find((a) => a.name === volunteer.user_name) : undefined);
	if (!account) return { kind: 'none' };

	const roleLabels = shelterCode
		? capabilitiesForShelter(account.roles, shelterCode).map(roleOptionLabel)
		: [];
	return account.active === false
		? { kind: 'deactivated', loginName: account.name, roleLabels }
		: { kind: 'linked', loginName: account.name, roleLabels };
}

export function hasVolunteerAccount(status: VolunteerAccessStatus): boolean {
	return status.kind !== 'none';
}
