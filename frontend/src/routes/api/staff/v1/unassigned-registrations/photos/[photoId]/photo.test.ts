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

function makeEvent(photoId: string, cookie = 'AuthSession=abc') {
	const url = new URL(`http://localhost/api/staff/v1/unassigned-registrations/photos/${photoId}`);
	return {
		params: { photoId },
		url,
		request: new Request(url, { headers: cookie ? { cookie } : {} }),
		fetch: vi.fn()
	} as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/staff/v1/unassigned-registrations/photos/[photoId]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		requireQueueAccess.mockResolvedValue({ ok: true });
	});

	it('streams the upstream bytes with the upstream content-type', async () => {
		const bytes = new Uint8Array([1, 2, 3, 4]);
		const fetchFn = vi
			.fn()
			.mockResolvedValue(
				new Response(bytes, { status: 200, headers: { 'Content-Type': 'image/webp' } })
			);
		const event = makeEvent('507f1f77bcf86cd799439011');
		event.fetch = fetchFn;

		const res = await GET(event);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toBe('private, no-store');
		expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:9000/staff/v1/unassigned-registrations/photos/507f1f77bcf86cd799439011',
			expect.objectContaining({
				headers: expect.objectContaining({ Cookie: 'AuthSession=abc' })
			})
		);
	});

	it('maps upstream 404 to a JSON error, not a broken image', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ errors: [{ error: { code: 'NOT_FOUND', message: 'gone' } }] }),
				{
					status: 404,
					headers: { 'Content-Type': 'application/json' }
				}
			)
		);
		const event = makeEvent('not-referenced');
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
		const event = makeEvent('507f1f77bcf86cd799439011');
		const res = await GET(event);
		expect(res.status).toBe(403);
		expect(event.fetch).not.toHaveBeenCalled();
	});
});
