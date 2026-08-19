/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import type { Referral } from '$lib/features/referrals/domain/referral.schema';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

const mockGet = vi.fn();

vi.mock('$lib/features/referrals/server/referral.server-repository', () => {
	class MockReferralServerRepository {
		get = mockGet;
	}
	return {
		CouchDbReferralServerRepository: MockReferralServerRepository
	};
});

function createMockEvent(
	id: string,
	searchParams: Record<string, string> = {},
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL(`http://localhost/api/back-office/referral/${id}`);
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		params: { id },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			}
		},
		url
	} as unknown as RequestEvent;
}

const mockReferral: Referral = {
	_id: 'referral:1',
	type: 'referral',
	schema_v: 1,
	shelter_code: 'SH001',
	to_shelter_code: 'SH002',
	created_at: '2026-07-11T05:00:00.000Z',
	updated_at: '2026-07-11T05:00:00.000Z',
	created_by: 'sm_user',
	evacuee_id: 'evacuee:1',
	referral_type: 'capacity',
	reason: 'Capacity transfer',
	urgency: 'normal',
	status: 'sent',
	timeline: {}
};

describe('GET /api/back-office/referral/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('allows System Admin to retrieve any referral', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sa_user',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
		mockGet.mockResolvedValue(mockReferral);

		const event = createMockEvent('referral:1', { shelter_code: 'SH003' });
		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data._id).toBe('referral:1');
	});

	it('allows originating shelter manager to retrieve their referral', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGet.mockResolvedValue(mockReferral);

		const event = createMockEvent('referral:1');
		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data._id).toBe('referral:1');
	});

	it('allows destination shelter manager to retrieve their referral', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user2',
			roles: ['shelter_manager', 'shelter:SH002'],
			isSA: false,
			shelterCode: 'SH002'
		});
		mockGet.mockResolvedValue(mockReferral);

		const event = createMockEvent('referral:1');
		const res = await GET(event);
		expect(res.status).toBe(200);

		const data = await res.json();
		expect(data._id).toBe('referral:1');
	});

	it('blocks (returns 403) third-party shelter manager from retrieving the referral', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user3',
			roles: ['shelter_manager', 'shelter:SH003'],
			isSA: false,
			shelterCode: 'SH003'
		});
		mockGet.mockResolvedValue(mockReferral);

		const event = createMockEvent('referral:1');
		const res = await GET(event);
		expect(res.status).toBe(403);

		const data = await res.json();
		expect(data.error).toContain('Forbidden: You do not have access');
	});

	it('returns 404 when referral is not found', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGet.mockResolvedValue(null);

		const event = createMockEvent('referral:999');
		const res = await GET(event);
		expect(res.status).toBe(404);

		const data = await res.json();
		expect(data.error).toContain('Referral not found');
	});
});
