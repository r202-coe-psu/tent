/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import { redactForScope } from '$lib/features/referrals/domain/referral.redaction';
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
const mockGetBatchFor = vi.fn();

vi.mock('$lib/features/referrals/server/referral.server-repository', () => {
	class MockReferralServerRepository {
		get = mockGet;
		getBatchFor = mockGetBatchFor;
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
	const url = new URL(`http://localhost/api/back-office/referral/${id}/batch`);
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

const sm = (code: string) => ({
	name: 'sm',
	roles: ['shelter_manager', `shelter:${code}`],
	isSA: false,
	shelterCode: code
});

describe('GET /api/back-office/referral/[id]/batch', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns the batch members for the source shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sm('SH001'));
		mockGet.mockResolvedValue(mockReferral);
		mockGetBatchFor.mockResolvedValue([mockReferral, { ...mockReferral, _id: 'referral:2' }]);

		const res = await GET(createMockEvent('referral:1'));
		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.items.map((r: Referral) => r._id)).toEqual(['referral:1', 'referral:2']);
		expect(mockGetBatchFor).toHaveBeenCalledWith(mockReferral);
	});

	it('allows the destination shelter', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sm('SH002'));
		mockGet.mockResolvedValue(mockReferral);
		mockGetBatchFor.mockResolvedValue([mockReferral]);
		expect((await GET(createMockEvent('referral:1'))).status).toBe(200);
	});

	it('returns 403 for a shelter outside the referral', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sm('SH003'));
		mockGet.mockResolvedValue(mockReferral);
		const res = await GET(createMockEvent('referral:1'));
		expect(res.status).toBe(403);
		expect(mockGetBatchFor).not.toHaveBeenCalled();
	});

	it('returns 404 when the anchor is missing', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sm('SH001'));
		mockGet.mockResolvedValue(null);
		const res = await GET(createMockEvent('referral:999'));
		expect(res.status).toBe(404);
		expect(mockGetBatchFor).not.toHaveBeenCalled();
	});

	it('passes members through redactForScope', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sm('SH001'));
		mockGet.mockResolvedValue(mockReferral);
		mockGetBatchFor.mockResolvedValue([mockReferral]);
		const res = await GET(createMockEvent('referral:1'));
		const { items } = await res.json();
		expect(items[0]).toEqual(redactForScope(mockReferral, 'internal'));
	});
});
