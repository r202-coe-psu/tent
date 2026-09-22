import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { buildPreRegistrationsList } from '$lib/server/system-overview';

vi.mock('$lib/server/system-overview', () => ({
	requireOverviewSA: vi.fn().mockResolvedValue({ name: 'sa', isSA: true }),
	parseOverviewFilters: vi.fn((params: URLSearchParams) => ({
		q: params.get('q') || undefined,
		shelter_code: params.get('shelter_code') || undefined,
		household_id: params.get('household_id') || undefined,
		limit: 50,
		offset: 0
	})),
	buildPreRegistrationsList: vi.fn(),
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

describe('GET /api/back-office/overview/pre-registrations', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('passes household_id filter to buildPreRegistrationsList', async () => {
		const mockPayload = {
			items: [
				{
					id: 'evacuee:01',
					first_name: 'สมชาย',
					last_name: 'ใจดี',
					shelter_code: 'SH001',
					household_id: 'household:hh-100',
					household_name: 'ครอบครัว สมชาย'
				}
			],
			total: 1,
			limit: 50,
			offset: 0
		};
		vi.mocked(buildPreRegistrationsList).mockResolvedValue(
			mockPayload as unknown as Awaited<ReturnType<typeof buildPreRegistrationsList>>
		);

		const res = await GET({
			request: new Request(
				'http://localhost/api/back-office/overview/pre-registrations?household_id=household:hh-100'
			),
			url: new URL(
				'http://localhost/api/back-office/overview/pre-registrations?household_id=household:hh-100'
			),
			fetch: vi.fn()
		} as unknown as Parameters<typeof GET>[0]);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.items).toHaveLength(1);
		expect(json.items[0].household_id).toBe('household:hh-100');
		expect(json.items[0].household_name).toBe('ครอบครัว สมชาย');
		expect(buildPreRegistrationsList).toHaveBeenCalledWith(
			expect.objectContaining({ household_id: 'household:hh-100' }),
			expect.any(Function),
			null
		);
	});

	it('returns stay_status and shelter details in response', async () => {
		const mockPayload = {
			items: [
				{
					id: 'bound:SH001:ev-01',
					display_name: 'สมชาย ใจดี',
					shelter_code: 'SH001',
					shelter_name: 'ศูนย์กีฬาเทศบาลนครเชียงใหม่',
					stay_status: 'active',
					queue_status: 'checked_in@SH001',
					registered_via: 'web',
					household_id: 'household:hh-100',
					household_name: 'ครอบครัว สมชาย'
				}
			],
			total: 1,
			limit: 50,
			offset: 0
		};
		vi.mocked(buildPreRegistrationsList).mockResolvedValue(
			mockPayload as unknown as Awaited<ReturnType<typeof buildPreRegistrationsList>>
		);

		const res = await GET({
			request: new Request(
				'http://localhost/api/back-office/overview/pre-registrations?stay_bucket=present'
			),
			url: new URL(
				'http://localhost/api/back-office/overview/pre-registrations?stay_bucket=present'
			),
			fetch: vi.fn()
		} as unknown as Parameters<typeof GET>[0]);

		expect(res.status).toBe(200);
		const json = await res.json();
		expect(json.items[0].stay_status).toBe('active');
		expect(json.items[0].shelter_name).toBe('ศูนย์กีฬาเทศบาลนครเชียงใหม่');
		expect(json.items[0].shelter_code).toBe('SH001');
	});
});
