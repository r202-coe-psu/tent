import { describe, it, expect, vi, beforeEach } from 'vitest';
import { error } from '@sveltejs/kit';
import { GET } from './+server';
import { requireShelterScopeOrSA, adminRaw } from '$lib/server/couch-admin';
import { SHELTER_VIEW_MANIFEST } from '$lib/features/shelters/server';
import type { RequestEvent } from './$types';

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

const sa = { name: 'tester', roles: [], isSA: true, shelterCode: null };
const currentDesign = {
	status: 200,
	data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version } }
};

describe('GET /api/back-office/shelter/[code]/dashboard/zones', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('returns 403 FORBIDDEN when the caller is outside the shelter scope', async () => {
		vi.mocked(requireShelterScopeOrSA).mockImplementation(async () => {
			error(403, 'Access denied: shelter scope mismatch');
		});

		const res = (await GET(createMockEvent('SH002'))) as Response;

		expect(res.status).toBe(403);
		expect((await res.json()).error.code).toBe('FORBIDDEN');
		expect(requireShelterScopeOrSA).toHaveBeenCalledWith('test_cookie', 'SH002');
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns 401 UNAUTHENTICATED when the request has no session cookie', async () => {
		vi.mocked(requireShelterScopeOrSA).mockImplementation(async () => {
			error(401, 'Not authenticated');
		});

		const res = (await GET(createMockEvent('SH001', null))) as Response;

		expect(res.status).toBe(401);
		expect((await res.json()).error.code).toBe('UNAUTHENTICATED');
		expect(requireShelterScopeOrSA).toHaveBeenCalledWith(null, 'SH001');
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns 500 with a message when the deployed views are older than v8', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version - 1 } }
		});

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.code).toBe('INTERNAL');
		expect(data.error.message).toContain('older version');
	});

	it('returns 500 when the occupancy_by_zone view is not deployed', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(currentDesign)
			.mockResolvedValueOnce({ status: 404, data: null });

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.message).toContain('not deployed');
	});

	it('returns 500 on a CouchDB view error', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(currentDesign)
			.mockResolvedValueOnce({ status: 500, data: { reason: 'boom' } });

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.message).toContain('CouchDB view error');
	});

	it('queries the grouped view and returns aggregate rows only', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue(sa);
		vi.mocked(adminRaw)
			.mockResolvedValueOnce(currentDesign)
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: ['A', 'active'], value: 3 },
						{ key: ['A', 'temporary_leave'], value: 1 },
						{ key: ['B', 'room_confirmed'], value: 2 }
					]
				}
			});

		const res = (await GET(createMockEvent('SH001'))) as Response;

		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			shelter_code: 'SH001',
			rows: [
				{ zone: 'A', status: 'active', count: 3 },
				{ zone: 'A', status: 'temporary_leave', count: 1 },
				{ zone: 'B', status: 'room_confirmed', count: 2 }
			]
		});
		const [path, method] = vi.mocked(adminRaw).mock.calls[1];
		expect(path).toBe('/shelter_sh001/_design/app/_view/occupancy_by_zone?group=true');
		expect(method).toBe('GET');
	});
});
