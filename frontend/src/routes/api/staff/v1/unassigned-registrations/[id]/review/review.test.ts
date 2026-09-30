import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-secret'
	}
}));

vi.mock('../../_auth', () => ({
	requireUnassignedRegistrationQueueAccess: vi.fn()
}));

import { requireUnassignedRegistrationQueueAccess } from '../../_auth';
import { GET } from './+server';

const requireQueueAccess = vi.mocked(requireUnassignedRegistrationQueueAccess);

function makeEvent(id: string, cookie = 'AuthSession=abc') {
	const url = new URL(`http://localhost/api/staff/v1/unassigned-registrations/${id}/review`);
	return {
		params: { id },
		url,
		request: new Request(url, { headers: cookie ? { cookie } : {} }),
		fetch: vi.fn()
	} as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/staff/v1/unassigned-registrations/[id]/review', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireQueueAccess.mockResolvedValue({ ok: true });
	});

	it('forwards cookie to FastAPI and passes the review body through', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ id: 'reg1', open_members: [], open_pets: [] }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' }
			})
		);
		const event = makeEvent('reg1');
		event.fetch = fetchFn;

		const res = await GET(event);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.id).toBe('reg1');
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:9000/staff/v1/unassigned-registrations/reg1/review',
			expect.objectContaining({
				headers: expect.objectContaining({ Cookie: 'AuthSession=abc' })
			})
		);
	});

	it('maps upstream NOT_FOUND through unchanged', async () => {
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(
					JSON.stringify({ errors: [{ error: { code: 'NOT_FOUND', message: 'not found' } }] }),
					{ status: 404, headers: { 'Content-Type': 'application/json' } }
				)
			);
		const event = makeEvent('missing');
		event.fetch = fetchFn;

		const res = await GET(event);
		expect(res.status).toBe(404);
		const body = await res.json();
		expect(body.error.code).toBe('NOT_FOUND');
	});

	it('rejects callers without registration-queue access', async () => {
		requireQueueAccess.mockResolvedValue({
			ok: false,
			response: new Response(
				JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Requires registration_staff' } }),
				{ status: 403, headers: { 'Content-Type': 'application/json' } }
			)
		});
		const event = makeEvent('reg1');
		const res = await GET(event);
		expect(res.status).toBe(403);
		expect(event.fetch).not.toHaveBeenCalled();
	});
});
