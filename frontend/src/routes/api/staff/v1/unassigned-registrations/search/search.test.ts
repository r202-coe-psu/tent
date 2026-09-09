import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-secret'
	}
}));

vi.mock('../_auth', () => ({
	requireUnassignedRegistrationSearchAccess: vi.fn()
}));

import { requireUnassignedRegistrationSearchAccess } from '../_auth';
import { GET } from './+server';

const requireSearchAccess = vi.mocked(requireUnassignedRegistrationSearchAccess);

function makeEvent(q: string, cookie = 'AuthSession=abc') {
	const url = new URL(`http://localhost/api/staff/v1/unassigned-registrations/search?q=${q}`);
	return {
		url,
		request: new Request(url, { headers: cookie ? { cookie } : {} }),
		fetch: vi.fn()
	} as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/staff/v1/unassigned-registrations/search', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireSearchAccess.mockResolvedValue({ ok: true });
	});

	it('forwards cookie to FastAPI and returns results', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ results: [{ id: 'doc1', open_members: [] }] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const event = makeEvent('สมชาย');
		event.fetch = fetchFn;

		const res = await GET(event);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.results[0].id).toBe('doc1');
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:9000/staff/v1/unassigned-registrations/search?q=%E0%B8%AA%E0%B8%A1%E0%B8%8A%E0%B8%B2%E0%B8%A2',
			expect.objectContaining({
				headers: expect.objectContaining({ Cookie: 'AuthSession=abc' })
			})
		);
	});

	it('maps upstream ONLINE_REQUIRED to 503', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					errors: [{ error: { code: 'ONLINE_REQUIRED', message: 'mongo down' } }]
				}),
				{ status: 503, headers: { 'Content-Type': 'application/json' } }
			)
		);
		const event = makeEvent('สมชาย');
		event.fetch = fetchFn;

		const res = await GET(event);
		expect(res.status).toBe(503);
		const body = await res.json();
		expect(body.error.code).toBe('ONLINE_REQUIRED');
	});

	it('rejects callers without shelter-scoped search access', async () => {
		requireSearchAccess.mockResolvedValue({
			ok: false,
			response: new Response(
				JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Requires shelter-scoped staff' } }),
				{ status: 403, headers: { 'Content-Type': 'application/json' } }
			)
		});
		const event = makeEvent('สมชาย');
		const res = await GET(event);
		expect(res.status).toBe(403);
		expect(event.fetch).not.toHaveBeenCalled();
	});
});
