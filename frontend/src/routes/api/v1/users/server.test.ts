import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateOrMergeUser, mockUpdateUser, mockAssertVerified } = vi.hoisted(() => ({
	mockCreateOrMergeUser: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockAssertVerified: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => ({
	authorizeUserWrite: vi.fn(async () => ({ name: 'sa', roles: ['system_admin'], isSA: true })),
	assertCanGrant: vi.fn(),
	serviceError: vi.fn((e: unknown) => {
		throw e;
	}),
	ServiceError: class extends Error {
		constructor(
			readonly code: string,
			message: string
		) {
			super(message);
		}
	}
}));
vi.mock('$lib/server/user-service', () => ({
	createOrMergeUser: mockCreateOrMergeUser,
	deleteUser: vi.fn(),
	listUsers: vi.fn(),
	updateUser: mockUpdateUser
}));
vi.mock('$lib/features/volunteers/server/volunteer-access-grant', () => ({
	assertVolunteerVerifiedForAccess: mockAssertVerified
}));
vi.mock('$lib/server/password-policy', () => ({
	validateProvisionedPassword: vi.fn((p: string) => p)
}));

import { POST, PUT } from './+server';

function post(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/v1/users', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify(body)
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/v1/users — CR-141 FR-23', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOrMergeUser.mockResolvedValue({ merged: false });
	});

	it.each([false, true, undefined])(
		'always provisions with must_change_password=true (body: %s)',
		async (flag) => {
			const res = await post({
				name: 'staff01',
				display_name: 'Staff 01',
				password: 'Temp-Pass-123',
				roles: ['shelter:SH001'],
				...(flag === undefined ? {} : { must_change_password: flag })
			});
			expect(res.status).toBe(200);
			expect(mockCreateOrMergeUser).toHaveBeenCalledWith(
				expect.objectContaining({ must_change_password: true }),
				expect.anything()
			);
		}
	);
});

describe('POST /api/v1/users with volunteer_id — CR-221 FR-3', () => {
	const body = {
		name: 'vol@example.com',
		display_name: 'Vol',
		password: 'Temp-Pass-123',
		roles: ['shelter:SH001', 'SH001:kitchen_staff'],
		personnel_type: 'volunteer'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOrMergeUser.mockResolvedValue({ merged: false });
		mockAssertVerified.mockResolvedValue(undefined);
	});

	it('checks the profile is verified in the shelters of the granted roles', async () => {
		await post({ ...body, volunteer_id: 'volunteer:V1' });
		expect(mockAssertVerified).toHaveBeenCalledWith(['SH001'], 'volunteer:V1');
		expect(mockCreateOrMergeUser).toHaveBeenCalled();
	});

	it('answers the 422 and creates nothing when the profile is not verified', async () => {
		mockAssertVerified.mockRejectedValue(new Error('unverified'));
		await expect(post({ ...body, volunteer_id: 'volunteer:V1' })).rejects.toThrow('unverified');
		expect(mockCreateOrMergeUser).not.toHaveBeenCalled();
	});

	it('leaves an account without a volunteer profile unchecked', async () => {
		await post({ ...body, personnel_type: 'staff' });
		expect(mockAssertVerified).not.toHaveBeenCalled();
	});
});

describe('PUT /api/v1/users — CR-221 A1-7', () => {
	beforeEach(() => vi.clearAllMocks());

	it('hands the identity check to the save, which runs it only for a role it adds', async () => {
		const request = new Request('http://localhost/api/v1/users', {
			method: 'PUT',
			headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
			body: JSON.stringify({
				name: 'vol@example.com',
				roles: ['shelter:SH001', 'SH001:medical_staff']
			})
		});
		const res = await PUT({ request } as Parameters<typeof PUT>[0]);
		expect(res.status).toBe(200);
		expect(mockUpdateUser).toHaveBeenCalledWith(
			'vol@example.com',
			expect.objectContaining({ roles: ['shelter:SH001', 'SH001:medical_staff'] }),
			expect.objectContaining({ isSA: true }),
			{ verifyVolunteerRoles: mockAssertVerified }
		);
	});
});
