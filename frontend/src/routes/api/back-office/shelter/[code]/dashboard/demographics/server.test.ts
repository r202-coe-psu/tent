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
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(
			new ServiceError('FORBIDDEN', 'Access denied')
		);

		const event = createMockEvent('SH001');
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe('FORBIDDEN');
	});

	it('returns 500 when the Dashboard demographic view is not deployed', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });

		const event = createMockEvent('SH001');
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.code).toBe('INTERNAL');
		expect(data.error.message).toContain('not deployed');
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
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.code).toBe('INTERNAL');
	});

	it('returns active demographic data from the Dashboard views', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});

		vi.mocked(adminRaw)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: 2026 + 543 - 30, value: 1 },
						{ key: 2026 + 543 - 2, value: 1 }
					]
				}
			})
			.mockResolvedValueOnce({
				status: 200,
				data: { rows: [{ key: 'THAILAND', value: 2 }] }
			});

		const event = createMockEvent('SH001');
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.shelter_code).toBe('SH001');
		expect(data.age_groups['18-59']).toBe(1);
		expect(data.age_groups['0-4']).toBe(1);
		expect(data.countries['THAILAND']).toBe(2);
		expect(data.countries['LAOS']).toBeUndefined();

		const [agePath, ageMethod] = vi.mocked(adminRaw).mock.calls[0];
		const [countryPath, countryMethod] = vi.mocked(adminRaw).mock.calls[1];
		expect(agePath).toBe('/shelter_sh001/_design/dashboard/_view/demographics_by_age?group=true');
		expect(ageMethod).toBe('GET');
		expect(countryPath).toBe(
			'/shelter_sh001/_design/dashboard/_view/demographics_by_country?group=true'
		);
		expect(countryMethod).toBe('GET');
	});
});
