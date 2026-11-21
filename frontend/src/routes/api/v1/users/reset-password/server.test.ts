import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockReset, mockRecordAuditedWrites } = vi.hoisted(() => ({
	mockReset: vi.fn(),
	mockRecordAuditedWrites: vi.fn(async () => undefined)
}));

vi.mock('$lib/server/couch-admin', () => ({
	authorizeUserWrite: vi.fn(async () => ({ name: 'sa', roles: ['system_admin'], isSA: true })),
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
	resetUserPasswordByAdmin: mockReset
}));
vi.mock('$lib/server/audit-log', () => ({ recordAuditedWrites: mockRecordAuditedWrites }));

import { POST } from './+server';

function post(name: string) {
	const request = new Request('http://localhost/api/v1/users/reset-password', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify({ name })
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/v1/users/reset-password — CR-259 audit wiring', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockReset.mockResolvedValue({
			temporary_password: 'calm-river-42',
			user: { display_name: 'Staff 01', roles: ['shelter:SH001'] }
		});
	});

	it('records user.password_reset for the shelters the account holds', async () => {
		const res = await post('staff01');

		expect(res.status).toBe(200);
		expect(mockRecordAuditedWrites).toHaveBeenCalledTimes(1);
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({
			actor: 'sa',
			event: 'user.password_reset',
			action: 'update',
			entityType: 'user',
			entityId: 'staff01'
		});
		expect(mockRecordAuditedWrites.mock.calls[0][1]).toEqual(['SH001']);
	});

	it('returns the temporary passphrase without a second read of the account', async () => {
		const res = await post('staff01');

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ ok: true, temporary_password: 'calm-river-42' });
		expect(mockRecordAuditedWrites.mock.calls[0][0]).toMatchObject({ label: 'Staff 01' });
		expect(mockRecordAuditedWrites.mock.calls[0][1]).toEqual(['SH001']);
	});

	it('rejects a missing name before touching the password', async () => {
		await expect(post('  ')).rejects.toThrow('name is required');
		expect(mockReset).not.toHaveBeenCalled();
		expect(mockRecordAuditedWrites).not.toHaveBeenCalled();
	});
});
