import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './+server';

vi.mock('$lib/server/system-overview', () => ({
	requireOverviewSA: vi.fn().mockResolvedValue({ name: 'sa', isSA: true }),
	parseOverviewFilters: vi.fn().mockReturnValue({
		movement_window: 'today',
		stay_bucket: 'all',
		source: 'all',
		limit: 50,
		offset: 0
	}),
	buildOverviewSummary: vi.fn().mockResolvedValue({
		unassigned_members: 3,
		unassigned_registrations: 2,
		pre_registered_at_sites: 4,
		present_total: 10,
		forecast_total: 17,
		avg_present_pct: 50,
		avg_forecast_pct: 85,
		sites_by_status: { active: 1 },
		checkouts_in_window: 1,
		sites_closed: 0,
		sites_open_with_present: 1,
		sites_total: 1,
		movement_window: 'today'
	}),
	noStore: { 'Cache-Control': 'no-store' }
}));

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		serviceError: (e: unknown) =>
			new Response(JSON.stringify({ error: String(e) }), { status: 500 })
	};
});

describe('GET /api/back-office/overview/summary', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns summary JSON for SA', async () => {
		const res = await GET({
			request: new Request('http://localhost/api/back-office/overview/summary'),
			url: new URL('http://localhost/api/back-office/overview/summary'),
			fetch: globalThis.fetch
		} as never);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.unassigned_members).toBe(3);
		expect(body.present_total).toBe(10);
	});
});
