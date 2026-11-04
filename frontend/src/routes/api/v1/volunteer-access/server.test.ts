import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readSessionUserCtx, grant, revoke, list } = vi.hoisted(() => ({
	readSessionUserCtx: vi.fn(),
	grant: vi.fn(),
	revoke: vi.fn(),
	list: vi.fn()
}));

vi.mock('$lib/server/couch-admin', () => {
	class ServiceError extends Error {
		constructor(
			readonly code: string,
			message: string
		) {
			super(message);
		}
	}
	return {
		ServiceError,
		readSessionUserCtx,
		serviceError: (e: unknown) =>
			Response.json(
				{ error: { code: (e as ServiceError).code ?? 'INTERNAL' } },
				{
					status:
						{ UNAUTHENTICATED: 401, FORBIDDEN: 403, VALIDATION: 422 }[(e as ServiceError).code] ??
						500
				}
			)
	};
});
vi.mock('$lib/features/volunteers/server/volunteer-access-grant', () => ({
	grantVolunteerAccessAsCoordinator: grant,
	listVolunteerGrantsAsCoordinator: list,
	revokeVolunteerAccessAsCoordinator: revoke
}));

import { DELETE, GET, POST } from './+server';

function post(body: Record<string, unknown>) {
	const request = new Request('http://localhost/api/v1/volunteer-access', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
		body: JSON.stringify(body)
	});
	return POST({ request } as Parameters<typeof POST>[0]);
}

describe('POST /api/v1/volunteer-access (#955)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		readSessionUserCtx.mockResolvedValue({
			name: 'staff03',
			roles: ['shelter:SH001', 'SH001:volunteer_coordinator']
		});
		grant.mockResolvedValue({ created: true, unchanged: false });
	});

	it('hands the session caller and the body to the grant policy', async () => {
		const body = {
			shelter_code: 'SH001',
			volunteer_id: 'volunteer:V1',
			email: 'vol@example.com',
			password: 'Temp-Pass-123!',
			role: 'kitchen_staff',
			expires_on: '2026-10-31'
		};
		const res = await post({ ...body, roles: ['system_admin'], granted_by: 'forged' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, created: true, unchanged: false });
		expect(grant).toHaveBeenCalledWith(
			{ name: 'staff03', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] },
			body
		);
	});

	it('answers 401 without a session and never reaches the policy', async () => {
		readSessionUserCtx.mockResolvedValue({ name: null, roles: [] });
		expect((await post({})).status).toBe(401);
		expect(grant).not.toHaveBeenCalled();
	});

	it('passes the policy refusal through as 403 / 422', async () => {
		const { ServiceError } = await import('$lib/server/couch-admin');
		grant.mockRejectedValueOnce(new ServiceError('FORBIDDEN', 'no'));
		expect((await post({ role: 'medical_staff' })).status).toBe(403);
		grant.mockRejectedValueOnce(new ServiceError('VALIDATION', 'bad'));
		expect((await post({})).status).toBe(422);
	});
});

describe('DELETE /api/v1/volunteer-access (#955)', () => {
	function del(body: Record<string, unknown>) {
		const request = new Request('http://localhost/api/v1/volunteer-access', {
			method: 'DELETE',
			headers: { 'Content-Type': 'application/json', cookie: 'AuthSession=x' },
			body: JSON.stringify(body)
		});
		return DELETE({ request } as Parameters<typeof DELETE>[0]);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		readSessionUserCtx.mockResolvedValue({
			name: 'staff03',
			roles: ['shelter:SH001', 'SH001:volunteer_coordinator']
		});
		revoke.mockResolvedValue(undefined);
	});

	it('hands the session caller and only the named fields to the revoke policy', async () => {
		const body = {
			shelter_code: 'SH001',
			volunteer_id: 'volunteer:V1',
			email: 'vol@example.com',
			role: 'kitchen_staff'
		};
		const res = await del({ ...body, granted_by: 'forged' });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
		expect(revoke).toHaveBeenCalledWith(
			{ name: 'staff03', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] },
			body
		);
	});

	it('answers 401 without a session and 403 when the policy refuses', async () => {
		readSessionUserCtx.mockResolvedValue({ name: null, roles: [] });
		expect((await del({})).status).toBe(401);
		expect(revoke).not.toHaveBeenCalled();
		readSessionUserCtx.mockResolvedValue({ name: 'staff03', roles: [] });
		const { ServiceError } = await import('$lib/server/couch-admin');
		revoke.mockRejectedValueOnce(new ServiceError('FORBIDDEN', 'no'));
		expect((await del({ role: 'kitchen_staff' })).status).toBe(403);
	});
});

describe('GET /api/v1/volunteer-access (#955)', () => {
	function get(query: string) {
		const url = new URL(`http://localhost/api/v1/volunteer-access${query}`);
		const request = new Request(url, { headers: { cookie: 'AuthSession=x' } });
		return GET({ request, url } as unknown as Parameters<typeof GET>[0]);
	}

	beforeEach(() => {
		vi.clearAllMocks();
		readSessionUserCtx.mockResolvedValue({
			name: 'staff03',
			roles: ['shelter:SH001', 'SH001:volunteer_coordinator']
		});
	});

	it('hands the session caller and the query to the list policy', async () => {
		const grants = [{ role: 'kitchen_staff', expires_at: '2026-10-31T16:59:59.999Z', mine: true }];
		list.mockResolvedValue({ email: 'vol@example.com', grants });
		const res = await get('?shelter_code=SH001&volunteer_id=volunteer%3AV1');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, email: 'vol@example.com', grants });
		expect(list).toHaveBeenCalledWith(
			{ name: 'staff03', roles: ['shelter:SH001', 'SH001:volunteer_coordinator'] },
			{ shelter_code: 'SH001', volunteer_id: 'volunteer:V1' }
		);
	});

	it('answers 401 without a session and 403 when the policy refuses', async () => {
		readSessionUserCtx.mockResolvedValue({ name: null, roles: [] });
		expect((await get('')).status).toBe(401);
		expect(list).not.toHaveBeenCalled();
		readSessionUserCtx.mockResolvedValue({ name: 'staff03', roles: [] });
		const { ServiceError } = await import('$lib/server/couch-admin');
		list.mockRejectedValueOnce(new ServiceError('FORBIDDEN', 'no'));
		expect((await get('?shelter_code=SH002')).status).toBe(403);
	});
});
