import { beforeEach, describe, expect, it, vi } from 'vitest';

const env = vi.hoisted(() => ({}) as Record<string, string | undefined>);
vi.mock('$env/dynamic/private', () => ({ env }));

import * as couchAdmin from '$lib/server/couch-admin';
import { EDGE_USERS_READONLY_MESSAGE } from '$lib/auth/edge-readonly';
import { POST } from './+server';

function post() {
	const request = new Request('http://localhost/api/v1/users', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify({
			name: 'staff01',
			display_name: 'Staff 01',
			password: 'Temp-Pass-123',
			roles: ['shelter:SH001']
		})
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/v1/users — EDGE_MODE (CR-171 FR-13)', () => {
	let adminRaw: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		vi.restoreAllMocks();
		delete env.EDGE_MODE;
		env.COUCHDB_ADMIN_URL = 'http://admin:pw@couchdb:5984';
		vi.spyOn(couchAdmin, 'authorizeUserWrite').mockResolvedValue({
			name: 'sa',
			roles: ['system_admin'],
			isSA: true
		} as Awaited<ReturnType<typeof couchAdmin.authorizeUserWrite>>);
		adminRaw = vi
			.spyOn(couchAdmin, 'adminRaw')
			.mockResolvedValue({ status: 404, data: { error: 'not_found' } });
	});

	it('answers 403 with the read-only message and writes nothing when on', async () => {
		env.EDGE_MODE = 'true';
		const res = await post();
		expect(res.status).toBe(403);
		expect(await res.json()).toMatchObject({
			error: { code: 'FORBIDDEN', message: EDGE_USERS_READONLY_MESSAGE }
		});
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('does not answer the read-only 403 when off (central)', async () => {
		const res = await post();
		const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
		expect(body?.error?.message).not.toBe(EDGE_USERS_READONLY_MESSAGE);
		expect(adminRaw).toHaveBeenCalled();
	});
});
