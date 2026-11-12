import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { findGroupByTvCode } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { listActiveForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';

const mockEnv = vi.hoisted(
	() => ({ EXTERNAL_API_SECRET: 'test-banner-secret' }) as Record<string, string | undefined>
);
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/kiosk-banners/kiosk-banner.server', () => ({
	listActiveForShelter: vi.fn()
}));
vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', () => ({
	findGroupByTvCode: vi.fn()
}));

const mockFind = vi.mocked(findGroupByTvCode);
const mockList = vi.mocked(listActiveForShelter);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const GROUP = { _id: 'kiosk_banner_group:A', shelter_code: 'SH001', tv_code: '123456' };

function request(shelter = 'SH001', search = '?c=123456'): RequestEvent {
	return {
		params: { shelter },
		url: new URL(`http://localhost/api/v1/kiosk/internal/${shelter}/banners${search}`),
		request: new Request(`http://localhost/api/v1/kiosk/internal/${shelter}/banners${search}`)
	} as unknown as RequestEvent;
}

const record = (id: string, extra: Record<string, unknown> = {}) =>
	({ _id: id, title: `Title ${id}`, caption: 'Caption', duration_sec: 8, ...extra }) as never;

describe('GET /api/v1/kiosk/internal/[shelter]/banners', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		mockEnv.EXTERNAL_API_SECRET = 'test-banner-secret';
		mockFind.mockImplementation(async (code) => (code === '123456' ? (GROUP as never) : null));
		mockList.mockResolvedValue([record('banner-1'), record('banner-2', { caption: undefined })]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("a valid code for this shelter returns that group's active tv banners as feed slides with signed image urls and no-store", async () => {
		const response = await GET(request());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = await response.json();
		expect(Object.keys(body).sort()).toEqual(['banners', 'fetched_at']);
		expect(body.fetched_at).toBe(NOW.toISOString());
		expect(body.banners).toHaveLength(2);
		expect(body.banners[0]).toMatchObject({
			id: 'banner-1',
			title: 'Title banner-1',
			caption: 'Caption',
			duration_sec: 8
		});
		expect(Object.keys(body.banners[0]).sort()).toEqual(
			['caption', 'duration_sec', 'id', 'image_url', 'title'].sort()
		);
		expect(body.banners[0].image_url).toMatch(
			/^\/api\/v1\/kiosk\/banners\/banner-1\/image\?exp=\d+&sig=[0-9a-f]{64}$/
		);
		expect(body.banners[1].caption).toBeNull();
		expect(mockList).toHaveBeenCalledWith('SH001', NOW, {
			groupId: GROUP._id,
			screenType: 'tv'
		});
	});

	it.each([
		['missing', ''],
		['malformed', '?c=12ab'],
		['unknown', '?c=999999']
	])('%s code returns 404 TV_CODE_NOT_FOUND', async (_name, search) => {
		const response = await GET(request('SH001', search));

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'TV_CODE_NOT_FOUND', message: 'ไม่พบรหัส TV นี้' }
		});
		expect(mockList).not.toHaveBeenCalled();
	});

	it('a valid code from another shelter gets the same 404 and the banners are never listed', async () => {
		const unknown = await GET(request('SH001', '?c=999999'));
		const response = await GET(request('SH002'));

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual(await unknown.json());
		expect(mockList).not.toHaveBeenCalled();
	});

	it.each([
		['the group lookup', () => mockFind.mockRejectedValueOnce(new Error('couch down'))],
		['the banner listing', () => mockList.mockRejectedValueOnce(new Error('couch down'))]
	])('returns 503 DEPENDENCY_UNAVAILABLE when %s fails', async (_name, fail) => {
		fail();
		const response = await GET(request());

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});
});
