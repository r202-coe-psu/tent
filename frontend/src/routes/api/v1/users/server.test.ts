import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockCreateOrMergeUser,
	mockUpdateUser,
	mockAssertVerified,
	mockDeleteUser,
	mockReadForLink,
	mockReadAfterWrite,
	mockRecordAuditedWrites
} = vi.hoisted(() => ({
	mockCreateOrMergeUser: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockAssertVerified: vi.fn(),
	mockDeleteUser: vi.fn(),
	mockReadForLink: vi.fn(async () => null),
	mockReadAfterWrite: vi.fn(async () => null),
	mockRecordAuditedWrites: vi.fn(async () => undefined)
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
	deleteUser: mockDeleteUser,
	listUsers: vi.fn(),
	updateUser: mockUpdateUser,
	isDeletedUserDoc: (doc: { deleted_at?: string | null } | null | undefined) =>
		Boolean(doc && doc.deleted_at),
	readUserDocForLink: mockReadForLink,
	readUserDocAfterWrite: mockReadAfterWrite
}));
vi.mock('$lib/server/audit-log', () => ({
	recordAuditedWrites: mockRecordAuditedWrites
}));
vi.mock('$lib/features/volunteers/server/volunteer-access-grant', () => ({
	assertVolunteerVerifiedForAccess: mockAssertVerified
}));
vi.mock('$lib/server/password-policy', () => ({
	validateProvisionedPassword: vi.fn((p: string) => p)
}));

import { DELETE, POST, PUT } from './+server';

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
				expect.anything(),
				// A merge checks the merged account's own profile (CR-221 A1-7).
				{ verifyVolunteerRoles: mockAssertVerified }
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

function del(name: string) {
	const request = new Request(`http://localhost/api/v1/users?name=${name}`, {
		method: 'DELETE',
		headers: { cookie: 'AuthSession=x' }
	});
	return DELETE({
		request,
		url: new URL(`http://localhost/api/v1/users?name=${name}`)
	} as Parameters<typeof DELETE>[0]);
}

describe('DELETE /api/v1/users — CR-259 audit reflects what the write did', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteUser.mockResolvedValue(undefined);
	});

	it('records user.deleted once the account is soft deleted', async () => {
		mockReadForLink.mockResolvedValue({
			display_name: 'Staff 01',
			roles: ['shelter:SH001']
		} as never);
		mockReadAfterWrite.mockResolvedValue({
			display_name: 'Staff 01',
			roles: [],
			deleted_at: '2026-11-19T00:00:00.000Z'
		} as never);

		const res = await del('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites).toHaveBeenCalledTimes(1);
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			event: 'user.deleted',
			action: 'delete',
			entityType: 'user',
			entityId: 'staff01'
		});
	});

	it('records user.roles_changed when the account survives with other shelters', async () => {
		mockReadForLink.mockResolvedValue({
			display_name: 'Staff 01',
			roles: ['shelter:SH001', 'shelter:SH002']
		} as never);
		mockReadAfterWrite.mockResolvedValue({
			display_name: 'Staff 01',
			roles: ['shelter:SH002']
		} as never);

		const res = await del('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites).toHaveBeenCalledTimes(1);
		const write = mockRecordAuditedWrites.mock.calls[0][0] as Record<string, unknown>;
		expect(write).toMatchObject({ event: 'user.roles_changed', action: 'update' });
		expect(write.before).toMatchObject({ roles: ['shelter:SH001', 'shelter:SH002'] });
		expect(write.after).toMatchObject({ roles: ['shelter:SH002'] });
	});

	it('still answers 200 when the read after the write faults', async () => {
		mockReadForLink.mockResolvedValue({ display_name: 'Staff 01', roles: [] } as never);
		mockReadAfterWrite.mockResolvedValue(null);

		const res = await del('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({ action: 'delete' });
	});
});
