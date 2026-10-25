import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import {
	authenticateScannerDevice,
	ScannerAuthError
} from '$lib/server/scanners/device-credentials';
import { listActiveForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';

const mockEnv = vi.hoisted(
	() => ({ EXTERNAL_API_SECRET: 'test-banner-secret' }) as Record<string, string | undefined>
);
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/features/kiosk-devices/server', () => ({ scannerServerRepository: {} }));
vi.mock('$lib/server/kiosk-banners/kiosk-banner.server', () => ({
	listActiveForShelter: vi.fn()
}));
vi.mock('$lib/server/scanners/device-credentials', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/scanners/device-credentials')>(
		'$lib/server/scanners/device-credentials'
	);
	return { ...actual, authenticateScannerDevice: vi.fn() };
});

const mockAuthenticate = vi.mocked(authenticateScannerDevice);
const mockList = vi.mocked(listActiveForShelter);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const GROUP_ID = 'kiosk_banner_group:A';
const deviceHeaders = { 'x-device-id': 'device-1', 'x-device-secret': 'secret' };

function request(
	body: unknown = {},
	headers: Record<string, string> = {},
	search = ''
): RequestEvent {
	const url = `http://localhost/api/v1/kiosk/banners${search}`;
	return {
		url: new URL(url),
		request: new Request(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...headers },
			body: JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

const record = (id: string, extra: Record<string, unknown> = {}) =>
	({
		_id: id,
		title: `Title ${id}`,
		caption: 'Caption',
		duration_sec: 8,
		shelter_code: 'SH001',
		...extra
	}) as never;

describe('POST /api/v1/kiosk/banners', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		mockEnv.EXTERNAL_API_SECRET = 'test-banner-secret';
		mockAuthenticate.mockImplementation(async (deviceId) => {
			if (!deviceId) throw new ScannerAuthError();
			return {
				shelter_code: 'SH001',
				screen_type: 'compact',
				banner_group_id: GROUP_ID
			} as never;
		});
		mockList.mockResolvedValue([record('banner-1'), record('banner-2', { caption: undefined })]);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('returns an empty feed without listing banners when the device has no banner group', async () => {
		mockAuthenticate.mockResolvedValueOnce({
			shelter_code: 'SH001',
			screen_type: 'compact',
			banner_group_id: null
		} as never);

		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ banners: [], fetched_at: NOW.toISOString() });
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns the active banners with signed image urls and fetched_at', async () => {
		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(200);
		const body = await response.json();
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
			groupId: GROUP_ID,
			screenType: 'compact'
		});
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
	});

	it('ignores any shelter supplied in the body or query', async () => {
		await POST(request({ shelter_code: 'SH999' }, deviceHeaders, '?shelter_code=SH998'));

		expect(mockList).toHaveBeenCalledTimes(1);
		expect(mockList).toHaveBeenCalledWith('SH001', NOW, {
			groupId: GROUP_ID,
			screenType: 'compact'
		});
	});

	it('lists banners for the device group and screen type', async () => {
		mockAuthenticate.mockResolvedValueOnce({
			shelter_code: 'SH001',
			screen_type: 'portrait',
			banner_group_id: GROUP_ID
		} as never);

		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(200);
		expect(mockList).toHaveBeenCalledWith('SH001', NOW, {
			groupId: GROUP_ID,
			screenType: 'portrait'
		});
		const body = await response.json();
		expect(Object.keys(body.banners[0])).not.toContain('screen_type');
	});

	it('returns 401 without reading banners when authentication fails', async () => {
		const response = await POST(request());

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 503 when the banner repository fails', async () => {
		mockList.mockRejectedValueOnce(new Error('couch down'));
		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(response.headers.get('pragma')).toBe('no-cache');
	});

	it('returns 503 when the image url secret is not configured', async () => {
		mockEnv.EXTERNAL_API_SECRET = undefined;
		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expect(response.headers.get('cache-control')).toBe('no-store');
	});

	it('returns an empty list when no banner is active', async () => {
		mockList.mockResolvedValueOnce([]);
		const response = await POST(request({}, deviceHeaders));

		expect(response.status).toBe(200);
		expect((await response.json()).banners).toEqual([]);
	});
});
