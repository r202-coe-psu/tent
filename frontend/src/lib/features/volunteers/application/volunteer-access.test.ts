import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Volunteer } from '../domain/volunteer.schema';
import type { UserSummary } from '$lib/features/users';

const mocks = vi.hoisted(() => ({
	createUser: vi.fn(),
	listUsers: vi.fn(),
	get: vi.fn(),
	update: vi.fn(),
	repositoryFor: vi.fn(),
	serviceFetch: vi.fn()
}));
vi.mock('$lib/api/service', () => ({ serviceFetch: mocks.serviceFetch }));
vi.mock('$lib/features/users', () => ({
	createUser: mocks.createUser,
	listUsers: mocks.listUsers
}));
vi.mock('../data/volunteer.remote', () => ({
	volunteerRepositoryFor: mocks.repositoryFor
}));

import {
	accessState,
	accountPhone,
	currentGrantRole,
	grantVolunteerAccess,
	grantVolunteerAccessAsCoordinator,
	hasInvalidAccessPhone,
	volunteerPasswordError
} from './volunteer-access';
import { grantExpiryRange } from '$lib/auth/role-grants';

const volunteer: Volunteer = {
	_id: 'volunteer:one',
	_rev: '1-a',
	type: 'volunteer',
	schema_v: 3,
	shelter_code: 'SH001',
	created_at: '2026-09-05T00:00:00Z',
	updated_at: '2026-09-05T00:00:00Z',
	created_by: 'manager',
	first_name: 'อาสา',
	last_name: 'ทดสอบ',
	phone: '0812345678',
	email: null,
	skills: [],
	status: 'active',
	user_name: null,
	checked_in: false,
	volunteer_code: 'V-001',
	identity_verified: true,
	source: 'staff_entry',
	personnel_type: 'volunteer'
};
const input = {
	email: 'helper@example.com',
	password: 'Valid-Pass123',
	role: 'registration_staff' as const
};
const account: UserSummary = {
	name: input.email,
	roles: ['shelter:SH001', `SH001:${input.role}`],
	personnel_type: 'volunteer',
	volunteer_id: volunteer._id,
	active: true
};

beforeEach(() => {
	vi.resetAllMocks();
	mocks.repositoryFor.mockReturnValue({ get: mocks.get, update: mocks.update });
	mocks.get.mockImplementation(async () => ({ ...volunteer }));
	mocks.listUsers.mockResolvedValue([]);
	mocks.createUser.mockResolvedValue({ ok: true });
	mocks.update.mockImplementation(async (profile) => profile);
});

describe('accountPhone', () => {
	it.each([
		['0887887878', '0887887878'],
		['088-788 7878', '0887887878'],
		['+66887887878', '0887887878'],
		['022222222', null],
		['ไม่มี', null],
		['', null],
		[null, null],
		[undefined, null]
	])('maps %s to %s', (input, expected) => {
		expect(accountPhone(input)).toBe(expected);
	});
});

describe('hasInvalidAccessPhone', () => {
	it.each([
		['022222222', true],
		['02-222-2222', true],
		['ไม่มี', true],
		['0887887878', false],
		['+66887887878', false],
		['', false],
		['  ', false],
		[null, false]
	])('%s -> %s', (input, expected) => {
		expect(hasInvalidAccessPhone(input)).toBe(expected);
	});
});

describe('volunteerPasswordError', () => {
	it('accepts the mobile login phone as a bootstrap password', () => {
		expect(volunteerPasswordError('0812345678', '0812345678')).toBeNull();
	});

	it('holds every other password to the user form policy', () => {
		expect(volunteerPasswordError('Valid-Pass123', null)).toBeNull();
		expect(volunteerPasswordError('0812345678', null)).toMatch(/ตัวพิมพ์ใหญ่/);
		expect(volunteerPasswordError('Short1!', '0812345678')).toMatch(/อย่างน้อย 10/);
	});
});

describe('grantVolunteerAccess', () => {
	it('creates a scoped login before linking the latest profile and email', async () => {
		mocks.get.mockResolvedValueOnce({ ...volunteer }).mockResolvedValueOnce({
			...volunteer,
			nickname: 'new nickname',
			skills: ['first-aid'],
			_rev: '2-b'
		});
		await expect(
			grantVolunteerAccess(volunteer, { ...input, email: ' helper@example.com ' })
		).resolves.toEqual({ created: true });
		expect(mocks.repositoryFor).toHaveBeenCalledWith('SH001');
		expect(mocks.createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				name: input.email,
				email: input.email,
				password: input.password,
				display_name: 'อาสา ทดสอบ',
				personnel_type: 'volunteer',
				roles: ['shelter:SH001', `SH001:${input.role}`],
				volunteer_id: volunteer._id,
				phone: volunteer.phone,
				must_change_password: false
			})
		);
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				user_name: input.email,
				email: input.email,
				nickname: 'new nickname',
				skills: ['first-aid'],
				_rev: '2-b'
			})
		);
		expect(mocks.createUser.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.update.mock.invocationCallOrder[0]
		);
	});

	it('lowercases the email before creating the account', async () => {
		await grantVolunteerAccess(volunteer, { ...input, email: 'Helper@Example.COM' });
		expect(mocks.createUser).toHaveBeenCalledWith(
			expect.objectContaining({ name: 'helper@example.com', email: 'helper@example.com' })
		);
	});

	it('links a legacy mixed-case account by its stored name instead of creating one', async () => {
		mocks.listUsers.mockResolvedValue([{ ...account, name: 'Helper@Example.com' }]);
		await expect(grantVolunteerAccess(volunteer, input)).resolves.toEqual({ created: false });
		expect(mocks.createUser).not.toHaveBeenCalled();
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ user_name: 'Helper@Example.com' })
		);
	});

	it('allows the volunteer phone as a forced first-login password', async () => {
		await grantVolunteerAccess(volunteer, {
			email: input.email,
			password: volunteer.phone!,
			role: input.role
		});
		expect(mocks.createUser).toHaveBeenCalledWith(
			expect.objectContaining({
				password: volunteer.phone,
				must_change_password: true
			})
		);
	});

	it.each([
		['empty', '', null],
		['dashed mobile', '088-788 7878', '0887887878']
	])('sends the account phone for a %s profile phone', async (_label, phone, expected) => {
		mocks.get.mockImplementation(async () => ({ ...volunteer, phone }));
		await grantVolunteerAccess({ ...volunteer, phone }, input);
		expect(mocks.createUser).toHaveBeenCalledWith(
			expect.objectContaining({ phone: expected, must_change_password: false })
		);
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ phone }));
	});

	it('grants a volunteer with no phone an account with phone null', async () => {
		const noPhone = { ...volunteer, phone: null };
		mocks.get.mockImplementation(async () => ({ ...noPhone }));
		await expect(grantVolunteerAccess(noPhone, input)).resolves.toEqual({ created: true });
		expect(mocks.createUser).toHaveBeenCalledWith(
			expect.objectContaining({ phone: null, email: input.email, must_change_password: false })
		);
	});

	it.each(['022222222', '02-222-2222', 'ไม่มี'])(
		'refuses to grant access while the profile phone is "%s"',
		async (phone) => {
			const bad = { ...volunteer, phone };
			mocks.get.mockImplementation(async () => ({ ...bad }));
			mocks.listUsers.mockResolvedValue([account]);
			await expect(grantVolunteerAccess(bad, input)).rejects.toThrow(/แก้เบอร์ในโปรไฟล์/);
			expect(mocks.createUser).not.toHaveBeenCalled();
			expect(mocks.update).not.toHaveBeenCalled();
		}
	);

	it.each([
		{ ...input, email: 'bad' },
		{ ...input, password: '0000000000' },
		{ ...input, role: 'system_admin' }
	])('rejects invalid credentials/roles before writing: %j', async (invalid) => {
		await expect(grantVolunteerAccess(volunteer, invalid as typeof input)).rejects.toThrow();
		expect(mocks.createUser).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('does not link the volunteer when account creation is denied', async () => {
		mocks.createUser.mockRejectedValue(new Error('Forbidden'));
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow('Forbidden');
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('does not create an account if listing users fails', async () => {
		mocks.listUsers.mockRejectedValue(new Error('Offline'));
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow('Offline');
		expect(mocks.createUser).not.toHaveBeenCalled();
	});

	it.each([
		{ ...account, volunteer_id: 'volunteer:other' },
		{ ...account, roles: ['shelter:SH002', `SH002:${input.role}`] },
		{ ...account, roles: ['shelter:SH002', input.role] },
		{ ...account, personnel_type: 'staff' as const },
		{ ...account, active: false },
		{ ...account, roles: ['shelter:SH001', 'SH001:warehouse_staff'] },
		{ ...account, roles: ['shelter:SH001', 'warehouse_staff'] },
		{ ...account, roles: ['shelter:SH001', `SH001:${input.role}`, 'SH001:warehouse_staff'] },
		{ ...account, roles: ['shelter:SH001', input.role, 'SH001:warehouse_staff'] },
		{ ...account, roles: ['shelter:SH001', `SH001:${input.role}`, input.role] },
		{ ...account, roles: ['shelter:SH001', 'system_admin'] },
		{ ...account, roles: ['shelter:SH001', '_admin'] },
		{ ...account, name: 'another@example.com' }
	])('does not adopt an existing mismatched account: %j', async (existing) => {
		mocks.listUsers.mockResolvedValue([existing]);
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow();
		expect(mocks.createUser).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('recovers profile linkage after partial failure without resetting credentials', async () => {
		mocks.update.mockRejectedValueOnce(new Error('Network error'));
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow(/บัญชี/);
		mocks.listUsers.mockResolvedValue([account]);
		await expect(grantVolunteerAccess(volunteer, input)).resolves.toEqual({ created: false });
		expect(mocks.createUser).toHaveBeenCalledTimes(1);
		expect(mocks.update).toHaveBeenCalledTimes(2);
	});

	it.each([
		{ label: 'compound', roles: ['shelter:SH001', `SH001:${input.role}`] },
		{ label: 'legacy flat', roles: ['shelter:SH001', input.role] }
	])('relinks an existing $label account without recreating it', async ({ roles }) => {
		mocks.listUsers.mockResolvedValue([{ ...account, roles }]);
		await expect(grantVolunteerAccess(volunteer, input)).resolves.toEqual({ created: false });
		expect(mocks.createUser).not.toHaveBeenCalled();
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ user_name: input.email, email: input.email })
		);
	});

	it('can replace the old mock-only user_name when there is no real account', async () => {
		mocks.get.mockResolvedValue({ ...volunteer, user_name: 'old@example.com' });
		await expect(grantVolunteerAccess(volunteer, input)).resolves.toEqual({ created: true });
		expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ user_name: input.email }));
	});

	it('fails before provisioning if the volunteer no longer exists', async () => {
		mocks.get.mockResolvedValue(null);
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow();
		expect(mocks.createUser).not.toHaveBeenCalled();
	});

	it('does not report success if the profile disappears after creation', async () => {
		mocks.get.mockResolvedValueOnce(volunteer).mockResolvedValueOnce(null);
		await expect(grantVolunteerAccess(volunteer, input)).rejects.toThrow(/บัญชี/);
		expect(mocks.createUser).toHaveBeenCalledTimes(1);
		expect(mocks.update).not.toHaveBeenCalled();
	});
});

describe('grantVolunteerAccessAsCoordinator (#955)', () => {
	const { min, max } = grantExpiryRange();
	const coordinatorInput = { ...input, expires_on: max };

	beforeEach(() => {
		mocks.serviceFetch.mockResolvedValue({ ok: true, created: true, unchanged: false });
	});

	it('asks the BFF to grant, then links the profile; never uses the generic user routes', async () => {
		await expect(grantVolunteerAccessAsCoordinator(volunteer, coordinatorInput)).resolves.toEqual({
			created: true,
			unchanged: false
		});
		expect(mocks.serviceFetch).toHaveBeenCalledWith('/api/v1/volunteer-access', {
			method: 'POST',
			body: JSON.stringify({
				shelter_code: 'SH001',
				volunteer_id: volunteer._id,
				email: input.email,
				password: input.password,
				role: input.role,
				expires_on: max
			})
		});
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({ user_name: input.email, email: input.email })
		);
		expect(mocks.createUser).not.toHaveBeenCalled();
		expect(mocks.listUsers).not.toHaveBeenCalled();
		expect(mocks.serviceFetch.mock.invocationCallOrder[0]).toBeLessThan(
			mocks.update.mock.invocationCallOrder[0]
		);
	});

	it('re-checks the stored profile phone: a landline saved meanwhile stops the grant (CR-210)', async () => {
		mocks.get.mockResolvedValueOnce({ ...volunteer, phone: '022222222' });
		await expect(grantVolunteerAccessAsCoordinator(volunteer, coordinatorInput)).rejects.toThrow();
		expect(mocks.serviceFetch).not.toHaveBeenCalled();
	});

	it('accepts today as the earliest expiry', async () => {
		await grantVolunteerAccessAsCoordinator(volunteer, { ...coordinatorInput, expires_on: min });
		expect(mocks.serviceFetch).toHaveBeenCalled();
	});

	it.each([
		['no expiry', { expires_on: '' }],
		['an expiry past the 7-day ceiling', { expires_on: '2999-01-01' }],
		['an expiry in the past', { expires_on: '2000-01-01' }],
		['a role the coordinator may not grant', { role: 'kiosk_staff' }],
		['a bad email', { email: 'bad' }],
		['a weak password', { password: '0000000000' }]
	])('rejects %s before calling the BFF', async (_label, over) => {
		await expect(
			grantVolunteerAccessAsCoordinator(volunteer, { ...coordinatorInput, ...over } as never)
		).rejects.toThrow();
		expect(mocks.serviceFetch).not.toHaveBeenCalled();
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('shows the BFF refusal (e.g. identity not verified) and links nothing', async () => {
		mocks.serviceFetch.mockRejectedValue(
			new Error('อาสาสมัครต้องยืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้')
		);
		await expect(grantVolunteerAccessAsCoordinator(volunteer, coordinatorInput)).rejects.toThrow(
			'ยืนยันตัวตน'
		);
		expect(mocks.update).not.toHaveBeenCalled();
	});

	it('still links the profile when the account already had the role', async () => {
		mocks.serviceFetch.mockResolvedValue({ ok: true, created: false, unchanged: true });
		await expect(grantVolunteerAccessAsCoordinator(volunteer, coordinatorInput)).resolves.toEqual({
			created: false,
			unchanged: true
		});
		expect(mocks.update).toHaveBeenCalled();
	});

	it('fails before the BFF if the volunteer no longer exists', async () => {
		mocks.get.mockResolvedValue(null);
		await expect(grantVolunteerAccessAsCoordinator(volunteer, coordinatorInput)).rejects.toThrow();
		expect(mocks.serviceFetch).not.toHaveBeenCalled();
	});
});

describe('currentGrantRole (#1044)', () => {
	const choices = ['kitchen_staff', 'warehouse_staff', 'registration_staff'] as const;

	it('is empty without grants, so nothing is preselected (#1072)', () => {
		expect(currentGrantRole([], choices)).toBe('');
	});

	it('picks the grant that runs longest', () => {
		expect(
			currentGrantRole(
				[
					{ role: 'kitchen_staff', expires_at: '2026-11-01T16:59:59.999Z' },
					{ role: 'warehouse_staff', expires_at: '2026-11-03T16:59:59.999Z' }
				],
				choices
			)
		).toBe('warehouse_staff');
	});

	it('skips a role the caller may not give', () => {
		expect(
			currentGrantRole([{ role: 'kiosk_staff', expires_at: '2026-11-03T16:59:59.999Z' }], choices)
		).toBe('');
	});
});

describe('accessState (#1044)', () => {
	const view = (over = {}) => ({
		has_account: true,
		grants: [],
		permanent_roles: [],
		last_ended: null,
		...over
	});

	it('is none without a loaded view or an account', () => {
		expect(accessState(null)).toEqual({ kind: 'none' });
		expect(accessState(view({ has_account: false }))).toEqual({ kind: 'none' });
	});

	it('is active while the account holds a grant or a manager role here', () => {
		expect(
			accessState(
				view({
					grants: [{ role: 'kitchen_staff', expires_at: '2026-11-03T16:59:59.999Z', mine: true }]
				})
			)
		).toEqual({ kind: 'active', permanentRoles: [] });
		expect(accessState(view({ permanent_roles: ['registration_staff'] }))).toEqual({
			kind: 'active',
			permanentRoles: ['registration_staff']
		});
	});

	it('is lapsed with how the last grant ended when it holds nothing here', () => {
		const ended = {
			role: 'kitchen_staff',
			reason: 'revoked' as const,
			at: '2026-10-31T17:00:00.000Z',
			by: 'coord01'
		};
		expect(accessState(view({ last_ended: ended }))).toEqual({ kind: 'lapsed', lastEnded: ended });
	});
});
