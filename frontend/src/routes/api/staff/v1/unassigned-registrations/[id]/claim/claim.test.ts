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
import { POST } from './+server';

const requireScope = vi.mocked(requireShelterScopeOrSA);
const canAccessQueue = vi.mocked(canAccessUnassignedRegistrationQueue);

function makeEvent(id: string, body: unknown, cookie = 'AuthSession=abc') {
	return {
		params: { id },
		request: new Request(`http://localhost/api/staff/v1/unassigned-registrations/${id}/claim`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				...(cookie ? { cookie } : {})
			},
			body: JSON.stringify(body)
		}),
		fetch: vi.fn()
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/staff/v1/unassigned-registrations/[id]/claim', () => {
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

	it('forwards cookie and member_ids to FastAPI', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					success: true,
					deleted: false,
					shelter_code: 'SH001',
					household_id: 'household:1',
					evacuee_ids: ['evacuee:1'],
					claimed: [],
					remaining_open: []
				}),
				{ status: 200, headers: { 'Content-Type': 'application/json' } }
			)
		);
		const event = makeEvent('doc1', { member_ids: ['evacuee:1'] });
		event.fetch = fetchFn;

		const res = await POST(event);
		expect(res.status).toBe(200);
		expect(fetchFn).toHaveBeenCalledWith(
			'http://localhost:9000/staff/v1/unassigned-registrations/doc1/claim',
			expect.objectContaining({
				method: 'POST',
				headers: expect.objectContaining({ Cookie: 'AuthSession=abc' }),
				body: JSON.stringify({ member_ids: ['evacuee:1'] })
			})
		);
	});

	it('maps ALREADY_CLAIMED from FastAPI', async () => {
		const fetchFn = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({
					errors: [{ error: { code: 'ALREADY_CLAIMED', message: 'taken' } }]
				}),
				{ status: 409, headers: { 'Content-Type': 'application/json' } }
			)
		);
		const event = makeEvent('doc1', { member_ids: ['evacuee:1'] });
		event.fetch = fetchFn;

		const res = await POST(event);
		expect(res.status).toBe(409);
		const body = await res.json();
		expect(body.error.code).toBe('ALREADY_CLAIMED');
	});

	it('rejects callers without registration capability', async () => {
		canAccessQueue.mockReturnValue(false);
		const event = makeEvent('doc1', { member_ids: ['evacuee:1'] });
		const res = await POST(event);
		expect(res.status).toBe(403);
		expect(event.fetch).not.toHaveBeenCalled();
	});
});
