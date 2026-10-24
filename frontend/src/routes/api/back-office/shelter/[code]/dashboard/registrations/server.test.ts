import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { requireShelterScopeOrSA, adminRaw, ServiceError } from '$lib/server/couch-admin';
import { SHELTER_VIEW_MANIFEST } from '$lib/features/shelters/server';
import { findMasterByCode } from '$lib/server/shelters.admin';
import type { ShelterMaster } from '$lib/features/shelters';
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

vi.mock('$lib/server/shelters.admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shelters.admin')>();
	return { ...actual, findMasterByCode: vi.fn() };
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
		vi.mocked(requireShelterScopeOrSA).mockRejectedValue(
			new ServiceError('FORBIDDEN', 'Access denied')
		);

		const event = createMockEvent('SH001');
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(403);
		const data = await res.json();
		expect(data.error.code).toBe('FORBIDDEN');
		expect(data.error.message).toBe('Access denied');
	});

	it('returns 500 when the Dashboard registrations view is not deployed', async () => {
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
		expect(data.error.message).toContain('registrations_by_date_status view error');
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
		vi.mocked(adminRaw)
			.mockResolvedValueOnce({
				status: 200,
				data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version } }
			})
			.mockResolvedValueOnce({
				status: 200,
				data: {
					rows: [
						{ key: [mockDate, 'checkin'], value: 5 },
						{ key: [mockDate, 'preregister'], value: 3 }
					]
				}
			});

		// Explicit date range so we know exactly what is requested
		const event = createMockEvent('SH001', { from: mockDate, to: mockDate });
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(200);
		const data = await res.json();

		expect(data.shelter_code).toBe('SH001');
		expect(data.total).toBe(5);
		expect(data.checkin).toBeTypeOf('object');
		expect(data.checkin[mockDate]).toBe(5);
		expect(data.checkout).toBeTypeOf('object');
		expect(data.preregister[mockDate]).toBe(3);

		const [path, method] = vi.mocked(adminRaw).mock.calls[1];
		expect(path).toContain(
			`/shelter_sh001/_design/app/_view/registrations_by_date_status?group=true`
		);
		expect(method).toBe('GET');
	});

	it('returns 500 when the deployed view version is older than this app build expects', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw).mockResolvedValue({
			status: 200,
			data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version - 1 } }
		});

		const event = createMockEvent('SH001');
		const res = (await GET(event)) as Response;

		expect(res.status).toBe(500);
		const data = await res.json();
		expect(data.error.code).toBe('INTERNAL');
		expect(data.error.message).toContain('older version');
	});

	describe('without `from`', () => {
		const viewDeployed = {
			status: 200,
			data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version } }
		};

		beforeEach(() => {
			vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
				name: 'tester',
				roles: [],
				isSA: true,
				shelterCode: null
			});
		});

		it('starts the range on the day the shelter was created', async () => {
			vi.mocked(findMasterByCode).mockResolvedValue({
				created_at: '2026-03-10T05:00:00.000Z'
			} as ShelterMaster);
			vi.mocked(adminRaw)
				.mockResolvedValueOnce(viewDeployed)
				.mockResolvedValueOnce({
					status: 200,
					data: {
						rows: [
							{ key: ['2026-03-12', 'checkin'], value: 4 },
							{ key: ['2026-05-01', 'checkout'], value: 1 }
						]
					}
				});

			const res = (await GET(createMockEvent('SH001', { to: '2026-10-16' }))) as Response;

			expect(res.status).toBe(200);
			const data = await res.json();
			expect(data.range).toEqual({ from: '2026-03-10', to: '2026-10-16' });
			expect(data.checkin['2026-03-12']).toBe(4);
			expect(data.checkout['2026-05-01']).toBe(1);
			expect(findMasterByCode).toHaveBeenCalledWith('SH001');

			// The whole view up to `to` is read — no startkey cuts off older movements.
			const [path] = vi.mocked(adminRaw).mock.calls[1];
			expect(path).not.toContain('startkey');
		});

		it('keeps a movement dated before the shelter was created', async () => {
			vi.mocked(findMasterByCode).mockResolvedValue({
				created_at: '2026-03-10T05:00:00.000Z'
			} as ShelterMaster);
			vi.mocked(adminRaw)
				.mockResolvedValueOnce(viewDeployed)
				.mockResolvedValueOnce({
					status: 200,
					data: { rows: [{ key: ['2026-03-01', 'checkin'], value: 2 }] }
				});

			const res = (await GET(createMockEvent('SH001', { to: '2026-10-16' }))) as Response;
			const data = await res.json();

			expect(data.range.from).toBe('2026-03-01');
			expect(data.total).toBe(2);
		});
	});

	it('does not look the shelter up when `from` is given', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});
		vi.mocked(adminRaw)
			.mockResolvedValueOnce({
				status: 200,
				data: { tent_view: { version: SHELTER_VIEW_MANIFEST.version } }
			})
			.mockResolvedValueOnce({ status: 200, data: { rows: [] } });

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-01', to: '2026-10-16' })
		)) as Response;
		const data = await res.json();

		expect(data.range).toEqual({ from: '2026-10-01', to: '2026-10-16' });
		expect(findMasterByCode).not.toHaveBeenCalled();
	});

	it('returns 422 when `from` is after `to`', async () => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles: [],
			isSA: true,
			shelterCode: null
		});

		const res = (await GET(
			createMockEvent('SH001', { from: '2026-10-16', to: '2026-10-01' })
		)) as Response;

		expect(res.status).toBe(422);
		const data = await res.json();
		expect(data.error.code).toBe('VALIDATION');
		expect(adminRaw).not.toHaveBeenCalled();
	});
});
