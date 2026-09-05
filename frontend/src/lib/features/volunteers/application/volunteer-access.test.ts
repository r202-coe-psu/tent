import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Volunteer } from '../domain/volunteer.schema';
import type { UserSummary } from '$lib/features/users';

const mocks = vi.hoisted(() => ({
	createUser: vi.fn(),
	listUsers: vi.fn(),
	get: vi.fn(),
	update: vi.fn(),
	repositoryFor: vi.fn()
}));
vi.mock('$lib/features/users', () => ({
	createUser: mocks.createUser,
	listUsers: mocks.listUsers
}));
vi.mock('../data/volunteer.remote', () => ({
	volunteerRepositoryFor: mocks.repositoryFor
}));

import { grantVolunteerAccess } from './volunteer-access';

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
	roles: ['shelter:SH001', input.role],
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
				roles: ['shelter:SH001', input.role],
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
		{ ...account, roles: ['shelter:SH002', input.role] },
		{ ...account, personnel_type: 'staff' as const },
		{ ...account, active: false },
		{ ...account, roles: ['shelter:SH001', 'warehouse_staff'] },
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
