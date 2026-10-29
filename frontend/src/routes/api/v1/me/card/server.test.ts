import { describe, it, expect, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import * as couchAdmin from '$lib/server/couch-admin';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

describe('/api/v1/me/card +server', () => {
	it('returns 401 when there is no session', async () => {
		vi.mocked(couchAdmin.readSessionUserCtx).mockResolvedValueOnce({ name: null, roles: [] });

		const res = await GET({
			request: new Request('http://localhost/api/v1/me/card')
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error.code).toBe('UNAUTHENTICATED');
	});
});
