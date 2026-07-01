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

function createMockEvent(
	code: string,
	searchParams: Record<string, string> = {},
	cookie: string | null = 'test_cookie'
): RequestEvent {
	const url = new URL('http://localhost/api');
	for (const [k, v] of Object.entries(searchParams)) {
		url.searchParams.set(k, v);
	}
	return {
		params: { code },
		request: {
			headers: {
				get: (key: string) => (key.toLowerCase() === 'cookie' ? cookie : null)
			}
		},
		url
	} as unknown as RequestEvent;
}

describe('GET /api/back-office/shelter/[code]/dashboard/registrations', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns 401/403 when requireShelterScopeOrSA throws', async () => {
		// e.g. caller is not authenticated or not in scope
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(new ServiceError('FORBIDDEN', 'Access denied'));

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;
		
		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe('FORBIDDEN');
		expect(data.error.message).toBe('Access denied');
	});

	it('returns graceful fallback on 404 (DB not found or view missing)', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({ status: 404, data: null });

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		
		// graceful fallback yields an empty object for daily and 0 for total
		expect(data.shelter_code).toBe('SH001');
		expect(data.total).toBe(0);
		expect(data.daily).toEqual({});
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
		expect(data.error.message).toContain('registrations_by_date view error');
	});

	it('returns successful data payload when view succeeds', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		// mock view result with one day's data
		const mockDate = new Date().toISOString().slice(0, 10); // e.g. '2026-07-01'
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ key: mockDate, value: 5 }
				]
			}
		});

		// Explicit date range so we know exactly what is requested
		const event = createMockEvent('SH001', { from: mockDate, to: mockDate });
		const res = await GET(event) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		
		expect(data.shelter_code).toBe('SH001');
		expect(data.total).toBe(5);
		expect(data.daily).toBeTypeOf('object');
		expect(data.daily[mockDate]).toBe(5);
	});
});
