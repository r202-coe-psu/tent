import { describe, expect, it } from 'vitest';
import {
	ACCOUNT_LIST_FILTERS,
	MANAGER_ISSUER_LABEL,
	buildAccountRows,
	countAccountRows,
	filterAccountRows,
	isExpiringSoon,
	sortAccountRows,
	type AccountListFilter
} from './volunteer-account-list';
import type { VolunteerAccount } from './volunteer-access-status';
import type { Volunteer } from './volunteer.schema';

const NOW = Date.parse('2026-11-02T03:00:00.000Z');
const HOUR = 60 * 60 * 1000;
const at = (hours: number) => new Date(NOW + hours * HOUR).toISOString();

const profile = (id: string, first: string, last: string, over: Partial<Volunteer> = {}) =>
	({ _id: id, first_name: first, last_name: last, status: 'active', ...over }) as Volunteer;

const account = (over: Partial<VolunteerAccount> = {}): VolunteerAccount => ({
	volunteer_id: 'volunteer:V1',
	name: 'somchai@example.com',
	active: true,
	grants: [],
	permanent_roles: [],
	...over
});

const volunteers = [
	profile('volunteer:V1', 'สมชาย', 'ใจดี', { nickname: 'ชาย' }),
	profile('volunteer:V2', 'กนกวรรณ', 'แสนสุข'),
	profile('volunteer:V3', 'ปิยะ', 'มั่นคง'),
	profile('volunteer:V4', 'วิชัย', 'เก่งกล้า', { status: 'inactive' }),
	profile('volunteer:V5', 'อารีย์', 'ใจงาม'),
	profile('volunteer:V6', 'มานะ', 'อดทน')
];

const accounts: VolunteerAccount[] = [
	// active, a coordinator grant ending in 3 days
	account({
		grants: [{ role: 'kitchen_staff', expires_at: at(72), granted_by: 'coord@example.com' }]
	}),
	// active, a coordinator grant ending in 5 hours
	account({
		volunteer_id: 'volunteer:V2',
		name: 'kanok@example.com',
		grants: [{ role: 'facility_staff', expires_at: at(5), granted_by: 'coord2@example.com' }]
	}),
	// active, only a manager's permanent role
	account({
		volunteer_id: 'volunteer:V3',
		name: 'piya@example.com',
		permanent_roles: ['registration_staff']
	}),
	// lapsed, and its profile is closed
	account({ volunteer_id: 'volunteer:V4', name: 'wichai@example.com' }),
	// account closed by an admin
	account({
		volunteer_id: 'volunteer:V5',
		name: 'aree@example.com',
		active: false,
		grants: [{ role: 'kitchen_staff', expires_at: at(2), granted_by: 'coord@example.com' }]
	}),
	// lapsed, profile open
	account({ volunteer_id: 'volunteer:V6', name: 'mana@example.com' }),
	// no profile in the list
	account({ volunteer_id: 'volunteer:V9', name: 'ghost@example.com' })
];

const rows = buildAccountRows(accounts, volunteers);
const idsFor = (filter: AccountListFilter, search = '') =>
	filterAccountRows(rows, { filter, search, now: NOW })
		.map((r) => r.volunteer._id)
		.sort();

describe('buildAccountRows', () => {
	it('joins each account to its profile and drops one with no profile', () => {
		expect(rows).toHaveLength(6);
		expect(rows.map((r) => r.loginName)).not.toContain('ghost@example.com');
		expect(rows[0]).toMatchObject({
			displayName: 'สมชาย ใจดี',
			loginName: 'somchai@example.com',
			profileClosed: false
		});
	});

	it('falls back to the login when the profile has no name', () => {
		const [row] = buildAccountRows([account()], [profile('volunteer:V1', ' ', ' ')]);
		expect(row.displayName).toBe('somchai@example.com');
	});

	it('names who issued a grant and leaves a permanent role without an issuer', () => {
		const mixed = buildAccountRows(
			[
				account({
					grants: [{ role: 'kitchen_staff', expires_at: at(72), granted_by: 'coord@example.com' }],
					permanent_roles: ['registration_staff']
				})
			],
			volunteers
		)[0];
		expect(mixed.roles.map((r) => [r.role, r.expiresAt === null, r.grantedBy])).toEqual([
			['registration_staff', true, null],
			['kitchen_staff', false, 'coord@example.com']
		]);
		expect(MANAGER_ISSUER_LABEL).toBe('ผู้จัดการศูนย์');
	});

	it('marks a closed profile and keeps the status of the account', () => {
		const closed = rows.find((r) => r.volunteer._id === 'volunteer:V4');
		expect(closed).toMatchObject({ profileClosed: true, status: { kind: 'lapsed' } });
		expect(rows.find((r) => r.volunteer._id === 'volunteer:V5')?.status.kind).toBe('deactivated');
	});
});

describe('filterAccountRows', () => {
	it('lists every account with no filter, lapsed and disabled ones included', () => {
		expect(idsFor('all')).toEqual(volunteers.map((v) => v._id).sort());
	});

	it.each([
		['active', ['volunteer:V1', 'volunteer:V2', 'volunteer:V3']],
		['lapsed', ['volunteer:V4', 'volunteer:V6']],
		['profile_closed', ['volunteer:V4']],
		// within a day, a manager's permanent role and a disabled account never count
		['expiring', ['volunteer:V2']]
	] as const)('%s keeps only its accounts', (filter, expected) => {
		expect(idsFor(filter)).toEqual(expected);
	});

	it('counts a grant ending exactly a day from now as expiring, but not one past it', () => {
		const edge = (hours: number) =>
			buildAccountRows(
				[account({ grants: [{ role: 'kitchen_staff', expires_at: at(hours), granted_by: 'c' }] })],
				volunteers
			)[0];
		expect(isExpiringSoon(edge(24), NOW)).toBe(true);
		expect(isExpiringSoon(edge(24.01), NOW)).toBe(false);
	});

	it('searches the name, nickname and email, ignoring case', () => {
		expect(idsFor('all', 'สมชาย')).toEqual(['volunteer:V1']);
		expect(idsFor('all', 'ใจดี')).toEqual(['volunteer:V1']);
		expect(idsFor('all', 'ชาย')).toEqual(['volunteer:V1']);
		expect(idsFor('all', 'KANOK@')).toEqual(['volunteer:V2']);
		expect(idsFor('all', '  piya  ')).toEqual(['volunteer:V3']);
		expect(idsFor('all', 'nobody')).toEqual([]);
	});

	it('applies the search inside the chosen filter', () => {
		expect(idsFor('lapsed', 'wichai')).toEqual(['volunteer:V4']);
		expect(idsFor('active', 'wichai')).toEqual([]);
	});
});

describe('sortAccountRows', () => {
	it('sorts by name in Thai order and does not mutate its input', () => {
		const before = rows.map((r) => r.displayName);
		const sorted = sortAccountRows(rows).map((r) => r.displayName);
		expect(sorted).toEqual([...before].sort((a, b) => a.localeCompare(b, 'th')));
		expect(rows.map((r) => r.displayName)).toEqual(before);
	});

	it('orders two people with the same name by login', () => {
		const twins = buildAccountRows(
			[
				account({ name: 'b@example.com', volunteer_id: 'volunteer:V1' }),
				account({ name: 'a@example.com', volunteer_id: 'volunteer:V1' })
			],
			volunteers
		);
		expect(sortAccountRows(twins).map((r) => r.loginName)).toEqual([
			'a@example.com',
			'b@example.com'
		]);
	});
});

describe('countAccountRows', () => {
	it('counts what each filter shows', () => {
		expect(countAccountRows(rows, NOW)).toEqual({
			all: 6,
			active: 3,
			lapsed: 2,
			profile_closed: 1,
			expiring: 1
		});
	});

	it('has a label for every filter', () => {
		expect(ACCOUNT_LIST_FILTERS.map((f) => f.value).sort()).toEqual(
			Object.keys(countAccountRows([], NOW)).sort()
		);
	});
});
