import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockCreateOrMergeUser } = vi.hoisted(() => ({ mockCreateOrMergeUser: vi.fn() }));

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
	updateUser: vi.fn()
}));
vi.mock('$lib/server/password-policy', () => ({
	validateProvisionedPassword: vi.fn((p: string) => p)
}));

import { POST } from './+server';

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
