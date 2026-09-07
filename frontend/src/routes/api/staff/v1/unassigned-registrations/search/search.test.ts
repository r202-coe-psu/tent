import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$env/dynamic/private', () => ({
	env: {
		FASTAPI_INTERNAL_URL: 'http://localhost:9000',
		EXTERNAL_API_SECRET: 'test-secret'
	}
}));

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn()
}));

vi.mock('$lib/auth/roles', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/auth/roles')>();
	return {
		...actual,
		canAccessUnassignedRegistrationQueue: vi.fn()
	};
});

import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { canAccessUnassignedRegistrationQueue } from '$lib/auth/roles';
import { GET } from './+server';

const requireScope = vi.mocked(requireShelterScopeOrSA);
const canAccessQueue = vi.mocked(canAccessUnassignedRegistrationQueue);

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
		requireScope.mockResolvedValue({
			name: 'reg.staff',
			roles: ['shelter:SH001', 'SH001:registration_staff'],
			isSA: false,
			shelterCode: 'SH001'
		});
		canAccessQueue.mockReturnValue(true);
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

	it('rejects callers without registration hold capability', async () => {
		canAccessQueue.mockReturnValue(false);
		const event = makeEvent('สมชาย');
		const res = await GET(event);
		expect(res.status).toBe(403);
		expect(event.fetch).not.toHaveBeenCalled();
	});
});
