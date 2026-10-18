import { describe, expect, it, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { searchHouseholds } from '$lib/server/system-overview';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';

vi.mock('$lib/server/system-overview', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/system-overview')>();
	return { ...actual, searchHouseholds: vi.fn() };
});

vi.mock('$lib/server/couch-admin', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/couch-admin')>();
	return {
		...actual,
		requireShelterScopeOrSA: vi.fn()
	};
});

describe('GET /api/back-office/overview/households', () => {
	const callAs = (roles: string[], isSA: boolean) => {
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'tester',
			roles,
			isSA,
			shelterCode: roles.find((r) => r.startsWith('shelter:'))?.slice(8) ?? null
		});
		const href = 'http://localhost/api/back-office/overview/households?scope=universal&q=x';
		return GET({
			request: new Request(href),
			url: new URL(href),
			fetch: globalThis.fetch
		} as never);
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(requireShelterScopeOrSA).mockResolvedValue({
			name: 'sa',
			roles: ['system_admin'],
			isSA: true,
			shelterCode: null
		});
	});

	it.each([
		['no roles', [] as string[]],
		['shelter_manager', ['shelter_manager', 'shelter:SH001']],
		['staff', ['staff', 'shelter:SH001']]
	])('rejects non-SA caller (%s) with 403 and does not search', async (_label, roles) => {
		const res = await callAs(roles, false);
		expect(res.status).toBe(403);
		const body = await res.json();
		expect(body.error.code).toBe('FORBIDDEN');
		expect(searchHouseholds).not.toHaveBeenCalled();
	});

	it('allows system_admin', async () => {
		vi.mocked(searchHouseholds).mockResolvedValue([]);
		const res = await callAs(['system_admin'], true);
		expect(res.status).toBe(200);
		expect(searchHouseholds).toHaveBeenCalledTimes(1);
	});

	it('returns universal households list', async () => {
		const mockItems = [
			{
				id: 'household:01',
				label: 'ครอบครัว สมชาย',
				status: 'unassigned',
				statusLabel: 'ยังไม่ผูกศูนย์',
				shelterCode: null,
				shelterName: null,
				province: 'เชียงใหม่',
				district: 'เมือง',
				subdistrict: 'สุเทพ',
				memberCount: 3,
				memberNames: ['สมชาย ใจดี', 'สมหญิง ใจดี'],
				scope: 'universal' as const
			},
			{
				id: 'household:02',
				label: 'ครอบครัว สมใจ',
				status: 'checked_in',
				statusLabel: 'อยู่ในศูนย์: SH001',
				shelterCode: 'SH001',
				shelterName: 'ศูนย์กีฬา',
				province: 'เชียงใหม่',
				district: 'เมือง',
				subdistrict: 'ช้างเผือก',
				memberCount: 2,
				memberNames: ['สมใจ นึก'],
				scope: 'universal' as const
			}
		];
		vi.mocked(searchHouseholds).mockResolvedValue(mockItems);

		const res = await GET({
			request: new Request(
				'http://localhost/api/back-office/overview/households?scope=universal&q=สม'
			),
			url: new URL('http://localhost/api/back-office/overview/households?scope=universal&q=สม'),
			fetch: globalThis.fetch
		} as never);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.items).toHaveLength(2);
		expect(body.items[0].label).toBe('ครอบครัว สมชาย');
		expect(searchHouseholds).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'universal',
				q: 'สม',
				limit: 20
			}),
			expect.any(Function),
			null
		);
	});

	it('returns shelter households list with shelter_code', async () => {
		const mockItems = [
			{
				id: 'household:02',
				label: 'ครอบครัว สมใจ',
				status: 'checked_in',
				statusLabel: 'ในศูนย์: SH001',
				shelterCode: 'SH001',
				shelterName: null,
				province: 'เชียงใหม่',
				district: 'เมือง',
				subdistrict: 'ช้างเผือก',
				memberCount: 0,
				memberNames: [],
				scope: 'shelter' as const
			}
		];
		vi.mocked(searchHouseholds).mockResolvedValue(mockItems);

		const res = await GET({
			request: new Request(
				'http://localhost/api/back-office/overview/households?scope=shelter&shelter_code=SH001'
			),
			url: new URL(
				'http://localhost/api/back-office/overview/households?scope=shelter&shelter_code=SH001'
			),
			fetch: globalThis.fetch
		} as never);

		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.items).toHaveLength(1);
		expect(searchHouseholds).toHaveBeenCalledWith(
			expect.objectContaining({
				scope: 'shelter',
				shelterCode: 'SH001'
			}),
			expect.any(Function),
			null
		);
	});
});
