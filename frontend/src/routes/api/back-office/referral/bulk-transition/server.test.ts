import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn()
}));

const mockBulk = vi.fn();

vi.mock('$lib/features/referrals/server/referral.bulk-transition', () => ({
	BULK_TRANSITION_MAX_IDS: 200,
	bulkTransition: (...args: unknown[]) => mockBulk(...args)
}));

function createMockEvent(body: unknown, search = ''): RequestEvent {
	return {
		request: {
			headers: { get: (key: string) => (key.toLowerCase() === 'cookie' ? 'test_cookie' : null) },
			json: async () => body
		},
		url: new URL(`http://localhost/api/back-office/referral/bulk-transition${search}`)
	} as unknown as RequestEvent;
}

const manager = {
	name: 'sm_user',
	roles: ['shelter_manager', 'shelter:SH001'],
	isSA: false,
	shelterCode: 'SH001'
};

describe('POST /api/back-office/referral/bulk-transition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(manager);
	});

	it('passes the session actor and shelter to the core and returns its result', async () => {
		const saved = { _id: 'referral:1', type: 'referral', status: 'closed', reason: 'r' };
		mockBulk.mockResolvedValue({
			succeeded: [saved],
			failed: [{ id: 'referral:2', error: 'Invalid referral transition' }]
		});

		const res = await POST(
			createMockEvent({
				ids: ['referral:1', 'referral:2'],
				to: 'closed',
				reason: '  ปิดงาน  ',
				// Identity in the body must be ignored.
				actor: 'attacker',
				shelter_code: 'SH999'
			})
		);

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			succeeded: [saved],
			failed: [{ id: 'referral:2', error: 'Invalid referral transition' }]
		});
		expect(mockBulk).toHaveBeenCalledWith(
			['referral:1', 'referral:2'],
			'closed',
			'ปิดงาน',
			'sm_user',
			'SH001'
		);
	});

	it('omits an empty reason', async () => {
		mockBulk.mockResolvedValue({ succeeded: [], failed: [] });
		await POST(createMockEvent({ ids: ['referral:1'], to: 'closed', reason: '   ' }));
		expect(mockBulk.mock.calls[0][2]).toBeUndefined();
	});

	it('returns 422 for more than 200 ids without calling the core', async () => {
		const ids = Array.from({ length: 201 }, (_, i) => `referral:${i}`);
		const res = await POST(createMockEvent({ ids, to: 'closed' }));
		expect(res.status).toBe(422);
		expect((await res.json()).error).toContain('200');
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it.each([
		['empty ids', { ids: [], to: 'closed' }],
		['blank id', { ids: ['  '], to: 'closed' }],
		['non-string id', { ids: [1], to: 'closed' }],
		['duplicate ids', { ids: ['referral:1', 'referral:1'], to: 'closed' }],
		['unknown status', { ids: ['referral:1'], to: 'archived' }],
		['missing to', { ids: ['referral:1'] }],
		['reason too long', { ids: ['referral:1'], to: 'closed', reason: 'a'.repeat(2001) }],
		['non-object body', null]
	])('returns 422 for %s', async (_name, body) => {
		const res = await POST(createMockEvent(body));
		expect(res.status).toBe(422);
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it('accepts exactly 200 ids', async () => {
		mockBulk.mockResolvedValue({ succeeded: [], failed: [] });
		const ids = Array.from({ length: 200 }, (_, i) => `referral:${i}`);
		const res = await POST(createMockEvent({ ids, to: 'closed' }));
		expect(res.status).toBe(200);
	});

	it('rejects a caller without the shelter_manager or system_admin role (403)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			...manager,
			roles: ['volunteer', 'shelter:SH001']
		});
		const res = await POST(createMockEvent({ ids: ['referral:1'], to: 'closed' }));
		expect(res.status).toBe(403);
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it('requires shelter_code from a system admin (400)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: undefined
		} as never);
		const res = await POST(createMockEvent({ ids: ['referral:1'], to: 'closed' }));
		expect(res.status).toBe(400);
		expect(mockBulk).not.toHaveBeenCalled();
	});

	it('uses the shelter_code query for a system admin', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'admin',
			roles: ['system_admin'],
			isSA: true
		} as never);
		mockBulk.mockResolvedValue({ succeeded: [], failed: [] });
		await POST(createMockEvent({ ids: ['referral:1'], to: 'closed' }, '?shelter_code=SH003'));
		expect(mockBulk.mock.calls[0].slice(3)).toEqual(['admin', 'SH003']);
	});
});
