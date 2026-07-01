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

describe('GET /api/back-office/shelter/[code]/dashboard/occupancy', () => {
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
		
		expect(data.shelter_code).toBe('SH001');
		expect(data.registered).toBe(0);
		expect(data.checked_in).toBe(0);
		expect(data.checked_out).toBe(0);
		expect(data.transferred).toBe(0);
		expect(data.total).toBe(0);
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
		expect(data.error.message).toContain('CouchDB view error');
	});

	it('returns successful data payload when view succeeds', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: {
				rows: [
					{ key: 'checked_in', value: 10 },
					{ key: 'registered', value: 5 }
				]
			}
		});

		const event = createMockEvent('SH001');
		const res = await GET(event) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();
		
		expect(data.shelter_code).toBe('SH001');
		expect(data.checked_in).toBe(10);
		expect(data.registered).toBe(5);
		expect(data.checked_out).toBe(0); // Defaulted to 0
		expect(data.total).toBe(15);
	});
});
