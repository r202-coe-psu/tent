import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { requireShelterScopeOrSA, adminRaw, ServiceError } from '$lib/server/couch-admin';
import type { RequestEvent } from './$types';

// Mock dependencies
vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireShelterScopeOrSA: vi.fn(),
		adminRaw: vi.fn()
	};
});

function createMockEvent(code: string, cookie: string | null = 'test_cookie'): RequestEvent {
	return {
		params: { code },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			}
		}
	} as unknown as RequestEvent;
}

describe('GET /api/back-office/shelter/[code]/dashboard/demographics', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns 401/403 when requireShelterScopeOrSA throws', async () => {
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(new ServiceError('FORBIDDEN', 'Access denied'));

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;
		
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe('FORBIDDEN');
	});

	it('returns graceful fallback on 404 (DB not found or view missing)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		// adminRaw is called twice (age, country), return 404 for both
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		
		expect(data.shelter_code).toBe('SH001');
		expect(data.age_groups['0-4']).toBe(0);
		expect(data.countries).toEqual({});
	});

	it('returns 500 on CouchDB view error (status >= 400)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({ status: 500, data: { reason: 'db error' } });

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.code).toBe('INTERNAL');
	});

	it('returns successful data payload when views succeed', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		
		// First call is demographics_by_age, second is demographics_by_country
		vi.mocked(adminRaw)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: '18-59', value: 20 },
						{ key: '0-4', value: 5 }
					]
				}
			})
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: 'THAILAND', value: 20 },
						{ key: 'LAOS', value: 5 }
					]
				}
			});

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		
		expect(data.shelter_code).toBe('SH001');
		expect(data.age_groups['18-59']).toBe(20);
		expect(data.age_groups['0-4']).toBe(5);
		expect(data.countries['THAILAND']).toBe(20);
		expect(data.countries['LAOS']).toBe(5);
	});
});
