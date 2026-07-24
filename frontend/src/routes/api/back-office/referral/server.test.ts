/* eslint-disable no-restricted-imports */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET, POST } from './+server';
import { requireShelterScopeOrSA, adminRaw } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';
import type { Referral } from '$lib/features/referrals/domain/referral.schema';

vi.mock('$lib/server/couch-admin', () => ({
	requireShelterScopeOrSA: vi.fn(),
	adminRaw: vi.fn(),
	ServiceError: class extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

const mockList = vi.fn();
const mockCreate = vi.fn();

vi.mock('$lib/features/referrals/server/referral.server-repository', () => {
	class MockReferralServerRepository {
		list = mockList;
		create = mockCreate;
	}
	return {
		CouchDbReferralServerRepository: MockReferralServerRepository
	};
});

function createMockEvent(
	searchParams: Record<string, string> = {},
	body: unknown = null,
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL('http://localhost/api/back-office/referral');
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			},
			json: async () => body
		},
		url
	} as unknown as RequestEvent;
}

const sampleEvacuee = {
	_id: 'evacuee:1',
	type: 'evacuee',
	schema_v: 2,
	shelter_code: 'SH001',
	created_at: '2026-07-11T05:00:00.000Z',
	updated_at: '2026-07-11T05:00:00.000Z',
	created_by: 'seed',
	first_name: 'A',
	last_name: 'B',
	gender: 'male',
	phone: '0811111111',
	country: 'THAILAND',
	special_needs: [],
	household_id: null,
	current_stay: { status: 'active', zone: 'A', since: '2026-07-11T05:00:00.000Z' },
	privacy: { search_excluded: false },
	registered_via: 'app'
};

describe('BFF Referral List and Create Endpoints', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	describe('GET /api/back-office/referral', () => {
		it('returns 403 when caller is not SA and not shelter_manager', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'staff_user',
				roles: ['registration_staff'],
				isSA: false,
				shelterCode: 'SH001'
			});

			const event = createMockEvent();
			const res = await GET(event);
			expect(res.status).toBe(403);
			const data = await res.json();
			expect(data.error).toContain('Requires shelter_manager or system_admin');
		});

		it('allows shelter_manager and lists referrals scoped to their shelter code', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'sm_user',
				roles: ['shelter_manager', 'shelter:SH002'],
				isSA: false,
				shelterCode: 'SH002'
			});

			const mockReferrals = [
				{
					_id: 'referral:1',
					type: 'referral',
					schema_v: 1,
					shelter_code: 'SH002',
					created_at: '2026-07-11T05:00:00.000Z',
					updated_at: '2026-07-11T05:00:00.000Z',
					created_by: 'sm_user',
					evacuee_id: 'evacuee:1',
					referral_type: 'medical-emergency',
					reason: 'x',
					urgency: 'normal',
					status: 'draft',
					timeline: {}
				}
			];
			mockList.mockResolvedValue(mockReferrals as unknown as Referral[]);

			const event = createMockEvent({ status: 'draft' });
			const res = await GET(event);
			expect(res.status).toBe(200);

			const data = await res.json();
			expect(data).toEqual(mockReferrals);
			expect(mockList).toHaveBeenCalledWith({ status: 'draft', evacuee_id: undefined });
		});
	});

	describe('POST /api/back-office/referral', () => {
		it('creates a new draft referral successfully', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'sm_user',
				roles: ['shelter_manager', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});
			vi.mocked(adminRaw).mockResolvedValue({ status: 200, data: sampleEvacuee });

			const bodyInput = {
				evacuee_id: 'evacuee:1',
				to_org: {
					kind: 'hospital',
					name: 'General Hospital',
					contact: '02-123-4567'
				},
				reason: 'Medical treatment needed',
				urgency: 'urgent',
				notes: 'Patient requires constant monitoring'
			};

			const mockCreatedReferral = {
				_id: 'referral:01F8MECHJCZGWFCP',
				type: 'referral',
				schema_v: 1,
				shelter_code: 'SH001',
				created_at: '2026-07-11T05:00:00.000Z',
				updated_at: '2026-07-11T05:00:00.000Z',
				created_by: 'sm_user',
				status: 'draft',
				referral_type: 'medical-emergency',
				timeline: {},
				...bodyInput
			};

			mockCreate.mockResolvedValue(mockCreatedReferral as unknown as Referral);

			const event = createMockEvent({}, bodyInput);
			const res = await POST(event);
			expect(res.status).toBe(201);

			const data = await res.json();
			expect(data).toEqual(mockCreatedReferral);
			expect(mockCreate).toHaveBeenCalledWith(
				expect.objectContaining({ evacuee_id: 'evacuee:1' }),
				{ shelterCode: 'SH001', createdBy: 'sm_user' }
			);
		});

		it('returns 422 when evacuee_id is missing from the shelter DB', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'sm_user',
				roles: ['shelter_manager', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});
			vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: { error: 'not_found' } });

			const event = createMockEvent(
				{},
				{
					evacuee_id: 'evacuee:missing',
					to_org: { kind: 'hospital', name: 'H' },
					reason: 'need care',
					urgency: 'normal'
				}
			);
			const res = await POST(event);
			expect(res.status).toBe(422);
			expect(mockCreate).not.toHaveBeenCalled();
		});

		it('returns 400 on validation failure', async () => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'sm_user',
				roles: ['shelter_manager', 'shelter:SH001'],
				isSA: false,
				shelterCode: 'SH001'
			});

			// invalid schema input (missing evacuee_id and to_org)
			const event = createMockEvent({}, { urgency: 'high' });
			const res = await POST(event);
			expect(res.status).toBe(400);

			const data = await res.json();
			expect(data.error).toBe('Validation failed');
		});
	});
});
