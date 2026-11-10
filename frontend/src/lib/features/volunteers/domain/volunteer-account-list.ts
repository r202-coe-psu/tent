/**
 * Rows, search and filters of the "บัญชีจิตอาสา" page (CR-221 FR-8). Pure: the page only renders
 * what these return.
 *
 * A row is one volunteer account the shelter's accounts endpoint returned (linked both ways,
 * FR-7), joined to the volunteer profile already loaded for the shelter. The profile gives the
 * person's name and whether the profile is closed; the account gives the login and the roles.
 */
import type { Volunteer } from './volunteer.schema';
import {
	accountRoles,
	volunteerAccessStatus,
	type AccessRole,
	type VolunteerAccessStatus,
	type VolunteerAccount
} from './volunteer-access-status';

/** A role the account holds here; `grantedBy` is `null` for a shelter manager's permanent role. */
export type AccountRoleRow = AccessRole & { grantedBy: string | null };

export type VolunteerAccountRow = {
	volunteer: Volunteer;
	/** The person's name from the profile, or the login when the profile has none. */
	displayName: string;
	/** The username (email) used to log in. */
	loginName: string;
	status: VolunteerAccessStatus;
	roles: AccountRoleRow[];
	profileClosed: boolean;
};

export type AccountListFilter = 'all' | 'active' | 'lapsed' | 'profile_closed' | 'expiring';

export const ACCOUNT_LIST_FILTERS: readonly { value: AccountListFilter; label: string }[] = [
	{ value: 'all', label: 'ทั้งหมด' },
	{ value: 'active', label: 'มีสิทธิ์อยู่' },
	{ value: 'lapsed', label: 'สิ้นสุดแล้ว' },
	{ value: 'profile_closed', label: 'โปรไฟล์ถูกปิด' },
	{ value: 'expiring', label: 'ใกล้หมดอายุ' }
];

/** "ใกล้หมดอายุ": a grant ends within this long from now (CR-221 FR-8: ≤ 1 วัน). */
export const EXPIRING_WITHIN_MS = 24 * 60 * 60 * 1000;

/** Shown as the issuer of a role a shelter manager gave. */
export const MANAGER_ISSUER_LABEL = 'ผู้จัดการศูนย์';

function profileName(volunteer: Volunteer): string {
	return `${volunteer.first_name} ${volunteer.last_name}`.trim();
}

/**
 * One row per account, joined to its profile by `volunteer_id`. An account whose profile is not in
 * `volunteers` is left out: the page has no person to show or act on.
 */
export function buildAccountRows(
	accounts: readonly VolunteerAccount[],
	volunteers: readonly Volunteer[]
): VolunteerAccountRow[] {
	const profiles = new Map(volunteers.map((v) => [v._id, v]));
	return accounts.flatMap((account) => {
		const volunteer = profiles.get(account.volunteer_id);
		if (!volunteer) return [];
		const issuers = new Map(account.grants.map((g) => [g.role, g.granted_by]));
		return [
			{
				volunteer,
				displayName: profileName(volunteer) || account.name,
				loginName: account.name,
				status: volunteerAccessStatus(volunteer, [account]),
				roles: accountRoles(account).map((r) => ({
					...r,
					grantedBy: r.expiresAt === null ? null : (issuers.get(r.role) ?? null)
				})),
				profileClosed: volunteer.status === 'inactive'
			}
		];
	});
}

/** True when a grant ending at `expiresAt` ends within a day of `now` (or already has). */
export function isEndingSoon(expiresAt: string | null, now: number): boolean {
	if (expiresAt === null) return false;
	const end = Date.parse(expiresAt);
	return Number.isFinite(end) && end - now <= EXPIRING_WITHIN_MS;
}

/** True when a role the account still holds here ends within a day (a manager's role never does). */
export function isExpiringSoon(row: VolunteerAccountRow, now: number): boolean {
	return row.status.kind === 'active' && row.roles.some((r) => isEndingSoon(r.expiresAt, now));
}

function matchesFilter(row: VolunteerAccountRow, filter: AccountListFilter, now: number): boolean {
	switch (filter) {
		case 'all':
			return true;
		case 'active':
			return row.status.kind === 'active';
		case 'lapsed':
			return row.status.kind === 'lapsed';
		case 'profile_closed':
			return row.profileClosed;
		case 'expiring':
			return isExpiringSoon(row, now);
	}
}

/** Case-insensitive match on the person's name (first, last, nickname) or the login email. */
export function matchesAccountSearch(row: VolunteerAccountRow, term: string): boolean {
	const needle = term.trim().toLowerCase();
	if (!needle) return true;
	const { volunteer } = row;
	return [row.displayName, volunteer.nickname ?? '', row.loginName]
		.join(' ')
		.toLowerCase()
		.includes(needle);
}

/** By the person's name, Thai collation; ties by login so the order is stable. */
export function sortAccountRows(rows: readonly VolunteerAccountRow[]): VolunteerAccountRow[] {
	return [...rows].sort(
		(a, b) =>
			a.displayName.localeCompare(b.displayName, 'th') || a.loginName.localeCompare(b.loginName)
	);
}

export function filterAccountRows(
	rows: readonly VolunteerAccountRow[],
	options: { search?: string; filter?: AccountListFilter; now: number }
): VolunteerAccountRow[] {
	const { search = '', filter = 'all', now } = options;
	return sortAccountRows(
		rows.filter((row) => matchesFilter(row, filter, now) && matchesAccountSearch(row, search))
	);
}

/** How many rows each filter would show, for the filter chips. */
export function countAccountRows(
	rows: readonly VolunteerAccountRow[],
	now: number
): Record<AccountListFilter, number> {
	const count = (filter: AccountListFilter) =>
		rows.filter((row) => matchesFilter(row, filter, now)).length;
	return {
		all: rows.length,
		active: count('active'),
		lapsed: count('lapsed'),
		profile_closed: count('profile_closed'),
		expiring: count('expiring')
	};
}
