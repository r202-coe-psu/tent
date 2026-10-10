import { describe, it, expect, beforeEach, vi } from 'vitest';
import { error } from '@sveltejs/kit';

// POST (provision a shelter) must accept the app `system_admin` role as well as
// Couch `_admin` — the system-management UI admits both via isSystemAdmin.
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireAdmin: vi.fn().mockRejectedValue(new Error('requireAdmin must not gate POST')),
		requireSystemAdmin: vi.fn()
	};
});
vi.mock('$lib/features/shelters/server/provisioner', () => ({
	provisionShelter: vi.fn()
}));

import { POST } from './+server';
import { requireSystemAdmin } from '$lib/server/couch-admin';
import { provisionShelter } from '$lib/features/shelters/server/provisioner';

const saMock = vi.mocked(requireSystemAdmin);
const provisionMock = vi.mocked(provisionShelter);

function callPOST(body: unknown = {}) {
	const request = new Request('http://localhost/api/back-office/shelter', {
		method: 'POST',
		headers: { cookie: 'AuthSession=abc', 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return POST({ request } as unknown as Parameters<typeof POST>[0]);
}

beforeEach(() => {
	saMock.mockReset().mockResolvedValue({
		name: 'sa',
		roles: ['system_admin'],
		isSA: true,
		shelterCode: null
	});
	provisionMock.mockReset();
});

describe('POST /api/back-office/shelter', () => {
	it('authorizes via requireSystemAdmin so an app system_admin can provision', async () => {
		await callPOST({});
		expect(saMock).toHaveBeenCalledWith('AuthSession=abc');
	});

	it('rejects a non-admin caller with 403 before provisioning', async () => {
		saMock.mockImplementationOnce(async () => error(403, 'System admin privileges required'));
		await expect(callPOST({})).rejects.toMatchObject({ status: 403 });
		expect(provisionMock).not.toHaveBeenCalled();
	});
});
