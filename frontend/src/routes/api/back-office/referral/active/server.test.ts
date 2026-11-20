import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { adminRaw, requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn()
}));

/** `_all_docs` answer where every requested key exists, except those listed. */
function shelterHas(missing: string[] = [], deleted: string[] = []) {
	vi.mocked(adminRaw).mockImplementation(async (_path, _method, body) => ({
		status: 200,
		data: {
			rows: (body as { keys: string[] }).keys.map((key) =>
				missing.includes(key)
					? { key, error: 'not_found' }
					: {
							key,
							id: key,
							value: { rev: '1-a', ...(deleted.includes(key) ? { deleted: true } : {}) }
						}
			)
		}
	}));
}

const mockLookup = vi.fn();
const constructed: unknown[][] = [];

vi.mock('$lib/features/referrals/server/referral.server-repository', () => ({
	ACTIVE_LOOKUP_MAX_IDS: 200,
	CouchDbReferralServerRepository: class {
		constructor(...args: unknown[]) {
			constructed.push(args);
		}
		activeReferralEvacueeIds = (...args: unknown[]) => mockLookup(...args);
	}
}));

function createMockEvent(body: unknown, search = ''): RequestEvent {
	return {
		request: {
			headers: { get: (key: string) => (key.toLowerCase() === 'cookie' ? 'test_cookie' : null) },
			json: async () => body
		},
		url: new URL(`http://localhost/api/back-office/referral/active${search}`)
	} as unknown as RequestEvent;
}

const manager = {
	name: 'sm_user',
	roles: ['shelter_manager', 'shelter:SH001'],
	isSA: false,
	shelterCode: 'SH001'
};

describe('POST /api/back-office/referral/active', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		constructed.length = 0;
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(manager);
		shelterHas();
	});

	it('returns the subset of the given ids that has an active referral', async () => {
		mockLookup.mockResolvedValue(['evacuee:B']);
		const res = await POST(createMockEvent({ evacuee_ids: ['evacuee:A', 'evacuee:B'] }));
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ evacuee_ids: ['evacuee:B'] });
		expect(mockLookup).toHaveBeenCalledWith(['evacuee:A', 'evacuee:B']);
		expect(constructed).toEqual([['central_ops', 'SH001']]);
	});

	it("drops ids outside the caller's shelter before looking up referrals", async () => {
		shelterHas(['evacuee:OTHER'], ['evacuee:GONE']);
		mockLookup.mockResolvedValue(['evacuee:A']);
		const res = await POST(
			createMockEvent({ evacuee_ids: ['evacuee:A', 'evacuee:OTHER', 'evacuee:GONE'] })
		);
		expect(await res.json()).toEqual({ evacuee_ids: ['evacuee:A'] });
		expect(vi.mocked(adminRaw).mock.calls[0].slice(0, 2)).toEqual([
			'/shelter_sh001/_all_docs',
			'POST'
		]);
		expect(mockLookup).toHaveBeenCalledWith(['evacuee:A']);
	});

	it('skips the referral lookup when none of the ids are in the shelter', async () => {
		shelterHas(['evacuee:OTHER']);
		const res = await POST(createMockEvent({ evacuee_ids: ['evacuee:OTHER'] }));
		expect(await res.json()).toEqual({ evacuee_ids: [] });
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('answers 502 when the shelter DB cannot be read', async () => {
		vi.mocked(adminRaw).mockResolvedValue({ status: 500, data: { error: 'boom' } });
		const res = await POST(createMockEvent({ evacuee_ids: ['evacuee:A'] }));
		expect(res.status).toBe(502);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('accepts exactly 200 ids', async () => {
		mockLookup.mockResolvedValue([]);
		const ids = Array.from({ length: 200 }, (_, i) => `evacuee:${i}`);
		const res = await POST(createMockEvent({ evacuee_ids: ids }));
		expect(res.status).toBe(200);
	});

	it.each([
		['more than 200 ids', { evacuee_ids: Array.from({ length: 201 }, (_, i) => `evacuee:${i}`) }],
		['empty ids', { evacuee_ids: [] }],
		['blank id', { evacuee_ids: ['  '] }],
		['non-string id', { evacuee_ids: [1] }],
		['missing ids', {}],
		['non-object body', null]
	])('returns 422 for %s without a lookup', async (_name, body) => {
		const res = await POST(createMockEvent(body));
		expect(res.status).toBe(422);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('rejects a caller without the shelter_manager or system_admin role (403)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			...manager,
			roles: ['volunteer', 'shelter:SH001']
		});
		const res = await POST(createMockEvent({ evacuee_ids: ['evacuee:A'] }));
		expect(res.status).toBe(403);
		expect(mockLookup).not.toHaveBeenCalled();
	});

	it('uses the shelter_code query for a system admin', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true
		} as never);
		mockLookup.mockResolvedValue([]);
		await POST(createMockEvent({ evacuee_ids: ['evacuee:A'] }, '?shelter_code=SH003'));
		expect(constructed).toEqual([['central_ops', 'SH003']]);
	});
});
