import { beforeEach, describe, expect, it, vi } from 'vitest';

const {
	mockCreateOrMergeUser,
	mockUpdateUser,
	mockAssertVerified,
	mockDeleteUser,
	mockRecordAuditedWrites
} = vi.hoisted(() => ({
	mockCreateOrMergeUser: vi.fn(),
	mockUpdateUser: vi.fn(),
	mockAssertVerified: vi.fn(),
	mockDeleteUser: vi.fn(),
	mockRecordAuditedWrites: vi.fn<(write: unknown, codes: unknown) => Promise<void>>(
		async () => undefined
	)
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
	updateUser: mockUpdateUser
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

import { authorizeUserWrite } from '$lib/server/couch-admin';
import { DELETE, GET, POST, PUT } from './+server';

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
		mockCreateOrMergeUser.mockResolvedValue({ merged: false, before: null, after: null });
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
		mockCreateOrMergeUser.mockResolvedValue({ merged: false, before: null, after: null });
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
	beforeEach(() => {
		vi.clearAllMocks();
		mockUpdateUser.mockResolvedValue({ before: null, after: null });
	});

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

function put(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/v1/users', {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify(body)
	});
	return PUT({ request } as Parameters<typeof PUT>[0]);
}

describe('POST and PUT /api/v1/users — CR-259 FR-24 audit wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOrMergeUser.mockResolvedValue({ merged: false, before: null, after: null });
		mockUpdateUser.mockResolvedValue({ before: null, after: null });
	});

	it('records user.created for a fresh account', async () => {
		await post({
			name: 'staff01',
			display_name: 'Staff 01',
			password: 'Temp-Pass-123',
			roles: ['shelter:SH001']
		});

		expect(mockRecordAuditedWrites).toHaveBeenCalledTimes(1);
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			event: 'user.created',
			action: 'create',
			entityId: 'staff01'
		});
	});

	it('records user.roles_changed with the saved name when a merge happens', async () => {
		mockCreateOrMergeUser.mockResolvedValue({
			merged: true,
			before: { display_name: 'ชื่อจริง', roles: ['shelter:SH001'] },
			after: { display_name: 'ชื่อจริง', roles: ['shelter:SH001', 'SH001:kitchen_staff'] }
		});

		await post({
			name: 'staff01',
			display_name: 'ชื่อจากฟอร์ม',
			password: 'Temp-Pass-123',
			roles: ['shelter:SH001', 'SH001:kitchen_staff']
		});

		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			event: 'user.roles_changed',
			action: 'update',
			label: 'ชื่อจริง'
		});
	});

	it('records user.roles_changed only for the shelter whose roles moved', async () => {
		mockUpdateUser.mockResolvedValue({
			before: { display_name: 'Staff 01', roles: ['shelter:SH001', 'shelter:SH002'] },
			after: {
				display_name: 'Staff 01',
				roles: ['shelter:SH001', 'shelter:SH002', 'SH002:kitchen_staff']
			}
		});

		await put({ name: 'staff01', roles: ['shelter:SH001', 'shelter:SH002'] });

		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			event: 'user.roles_changed'
		});
		expect(mockRecordAuditedWrites.mock.calls[0][1]).toEqual(['SH002']);
	});

	it('records user.updated when only the display name moves', async () => {
		mockUpdateUser.mockResolvedValue({
			before: { display_name: 'เดิม', roles: ['shelter:SH001'] },
			after: { display_name: 'ใหม่', roles: ['shelter:SH001'] }
		});

		await put({ name: 'staff01', display_name: 'ใหม่' });

		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			event: 'user.updated',
			action: 'update'
		});
	});
});

describe('DELETE /api/v1/users — CR-259 audit reflects what the write did', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockDeleteUser.mockResolvedValue({ deleted: true, before: null, after: null });
	});

	it('records user.deleted once the account is soft deleted', async () => {
		mockDeleteUser.mockResolvedValue({
			deleted: true,
			before: { display_name: 'Staff 01', roles: ['shelter:SH001'] },
			after: { display_name: 'Staff 01', roles: [], deleted_at: '2026-11-19T00:00:00.000Z' }
		});

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
		mockDeleteUser.mockResolvedValue({
			deleted: false,
			before: { display_name: 'Staff 01', roles: ['shelter:SH001', 'shelter:SH002'] },
			after: { display_name: 'Staff 01', roles: ['shelter:SH002'] }
		});

		const res = await del('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites).toHaveBeenCalledTimes(1);
		const write = mockRecordAuditedWrites.mock.calls[0][0] as Record<string, unknown>;
		expect(write).toMatchObject({ event: 'user.roles_changed', action: 'update' });
		expect(write.before).toMatchObject({ roles: ['shelter:SH001', 'shelter:SH002'] });
		expect(write.after).toMatchObject({ roles: ['shelter:SH002'] });
		expect(mockRecordAuditedWrites.mock.calls[0][1]).toEqual(['SH001']);
	});

	it('never guesses a delete from a missing snapshot', async () => {
		mockDeleteUser.mockResolvedValue({
			deleted: false,
			before: { display_name: 'Staff 01', roles: ['shelter:SH001', 'shelter:SH002'] },
			after: null
		});

		const res = await del('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({ action: 'update' });
	});
});

describe('/api/v1/users names the shelter it works in (#477)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockCreateOrMergeUser.mockResolvedValue({ merged: false });
	});

	const call = (
		handler: typeof GET | typeof POST | typeof PUT | typeof DELETE,
		method: string,
		query: string,
		body?: Record<string, unknown>
	) =>
		handler({
			request: new Request(`http://localhost/api/v1/users${query}`, {
				method,
				headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
				body: body ? JSON.stringify(body) : undefined
			}),
			url: new URL(`http://localhost/api/v1/users${query}`)
		} as Parameters<typeof GET>[0]);

	it.each([
		['GET', GET, '?shelter_code=SH002', undefined],
		['POST', POST, '?shelter_code=SH002', { name: 'staff01', display_name: 'S', password: 'x' }],
		['PUT', PUT, '?shelter_code=SH002', { name: 'staff01' }],
		['DELETE', DELETE, '?name=staff01&shelter_code=SH002', undefined]
	] as const)(
		'%s hands ?shelter_code= to the authorization',
		async (method, handler, query, body) => {
			await call(handler, method, query, body);
			expect(authorizeUserWrite).toHaveBeenCalledWith('AuthSession=x', 'SH002');
		}
	);

	it('passes null when the request names no shelter, so a multi-shelter manager gets a 400', async () => {
		await call(GET, 'GET', '');
		expect(authorizeUserWrite).toHaveBeenCalledWith('AuthSession=x', null);
	});
});
