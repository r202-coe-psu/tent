import { beforeEach, describe, expect, it, vi } from 'vitest';

const { readSessionUserCtx, find } = vi.hoisted(() => ({
	readSessionUserCtx: vi.fn(),
	find: vi.fn()
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	readSessionUserCtx
}));
vi.mock('$lib/features/volunteers/server/cross-shelter-verification', () => ({
	findCrossShelterVerifications: find
}));

import { ServiceError } from '$lib/server/couch-admin';
import { GET } from './+server';

const get = (query: string) =>
	GET({
		request: new Request(
			`http://localhost/api/v1/volunteer-access/cross-shelter-verifications?${query}`,
			{
				headers: { cookie: 'AuthSession=x' }
			}
		),
		url: new URL(`http://localhost/api/v1/volunteer-access/cross-shelter-verifications?${query}`)
	} as Parameters<typeof GET>[0]);

beforeEach(() => {
	vi.clearAllMocks();
	readSessionUserCtx.mockResolvedValue({
		name: 'sm02',
		roles: ['shelter:SH002', 'SH002:shelter_manager']
	});
});

describe('GET /api/v1/volunteer-access/cross-shelter-verifications (CR-228)', () => {
	it('passes the session caller and the query to the search and answers its matches', async () => {
		const matches = [
			{ shelter_code: 'SH001', shelter_name: 'ศูนย์ 1', identity: null, skills: [] }
		];
		find.mockResolvedValue({ matches });
		const res = await get('shelter_code=SH002&volunteer_id=volunteer:own');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true, matches });
		expect(find).toHaveBeenCalledWith(
			{ name: 'sm02', roles: ['shelter:SH002', 'SH002:shelter_manager'] },
			{ shelter_code: 'SH002', volunteer_id: 'volunteer:own' }
		);
	});

	it('answers 401 without a session and never searches', async () => {
		readSessionUserCtx.mockResolvedValue({ name: null, roles: [] });
		const res = await get('shelter_code=SH002&volunteer_id=volunteer:own');
		expect(res.status).toBe(401);
		expect(find).not.toHaveBeenCalled();
	});

	it.each([
		['FORBIDDEN', 403],
		['VALIDATION', 422],
		['NOT_FOUND', 404],
		['DEPENDENCY_UNAVAILABLE', 503]
	] as const)('answers %s as %i in the contract envelope', async (code, status) => {
		find.mockRejectedValue(new ServiceError(code, 'no'));
		const res = await get('shelter_code=SH002&volunteer_id=volunteer:own');
		expect(res.status).toBe(status);
		expect(await res.json()).toMatchObject({ error: { code } });
	});
});
