/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PATCH } from './+server';
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

const mockTransition = vi.fn();

vi.mock('$lib/features/referrals/server/referral.server-repository', () => {
	class MockReferralServerRepository {
		transition = mockTransition;
	}
	return {
		CouchDbReferralServerRepository: MockReferralServerRepository
	};
});

function createMockEvent(
	id: string,
	body: unknown = null,
	cookie: string | null = 'test_cookie'
): RequestEvent {
	return {
		params: { id },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			},
			json: async () => body
		},
		url: new URL(`http://localhost/api/back-office/referral/${id}/transition`)
	} as unknown as RequestEvent;
}

describe('PATCH /api/back-office/referral/[id]/transition', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('transitions state successfully and retries on 409 conflict', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});

		// Mock the first attempt returning 409 conflict, and the second succeeding
		mockTransition
			.mockRejectedValueOnce({ status: 409, message: 'Conflict' })
			.mockResolvedValueOnce({
				_id: 'referral:1',
				type: 'referral',
				status: 'sent'
			} as unknown as Referral);

		const event = createMockEvent('referral:1', { to: 'sent' });
		const res = await PATCH(event);

		expect(res.status).toBe(200);
		const data = await res.json();
		expect(data.status).toBe('sent');
		expect(mockTransition).toHaveBeenCalledTimes(2);
	});

	it('returns 422 for invalid transition target status', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});

		const event = createMockEvent('referral:1', { to: 'invalid_status' });
		const res = await PATCH(event);
		expect(res.status).toBe(422);

		const data = await res.json();
		expect(data.error).toContain('Invalid transition status');
	});

	it('fails after 3 retries on conflict', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sm_user',
			roles: ['shelter_manager', 'shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});

		mockTransition.mockRejectedValue({ status: 409, message: 'Conflict' });

		const event = createMockEvent('referral:1', { to: 'sent' });
		const res = await PATCH(event);
		expect(res.status).toBe(409);

		const data = await res.json();
		expect(data.error).toContain('Conflict: transition failed');
		expect(mockTransition).toHaveBeenCalledTimes(3);
	});
});
