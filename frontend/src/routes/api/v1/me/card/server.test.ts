import { describe, it, expect, vi, afterEach } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('/api/v1/me/card +server', () => {
	it('returns 401 when there is no session', async () => {
		vi.spyOn(globalThis, 'fetch').mockResolvedValue(
			Response.json({ userCtx: { name: null, roles: [] } })
		);

		const res = await GET({
			request: new Request('http://localhost/api/v1/me/card')
		} as unknown as RequestEvent);

		expect(res.status).toBe(401);
		const data = await res.json();
		expect(data.error.code).toBe('UNAUTHENTICATED');
	});
});
