import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { getBanner, getBannerImage } from '$lib/server/kiosk-banners/kiosk-banner.server';
import {
	KIOSK_BANNER_URL_TTL_MS,
	signBannerImageUrl
} from '$lib/server/kiosk-banners/signed-image-url';

const mockEnv = vi.hoisted(
	() => ({ EXTERNAL_API_SECRET: 'test-banner-secret' }) as Record<string, string | undefined>
);
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/kiosk-banners/kiosk-banner.server', () => ({
	getBanner: vi.fn(),
	getBannerImage: vi.fn()
}));

const mockGetBanner = vi.mocked(getBanner);
const mockGetImage = vi.mocked(getBannerImage);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

const activeBanner = (extra: Record<string, unknown> = {}) =>
	({
		_id: 'banner-1',
		status: 'active',
		start_at: '2026-10-15T00:00:00.000Z',
		end_at: '2026-10-16T00:00:00.000Z',
		...extra
	}) as never;

function event(id = 'banner-1', query?: string): RequestEvent {
	const signed = signBannerImageUrl(id, NOW.getTime());
	const url = new URL(
		query === undefined ? signed : `${signed.split('?')[0]}${query}`,
		'http://localhost'
	);
	return { params: { id }, url, request: new Request(url) } as unknown as RequestEvent;
}

function expectNoStore(response: Response) {
	expect(response.headers.get('cache-control')).toBe('no-store');
	expect(response.headers.get('pragma')).toBe('no-cache');
}

describe('GET /api/v1/kiosk/banners/[id]/image', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(NOW);
		mockEnv.EXTERNAL_API_SECRET = 'test-banner-secret';
		mockGetBanner.mockResolvedValue(activeBanner());
		mockGetImage.mockResolvedValue({ bytes: BYTES, contentType: 'image/png' });
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('serves the image bytes with its content type for a valid signature', async () => {
		const response = await GET(event());

		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toBe('image/png');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array(BYTES));
		expect(mockGetBanner).toHaveBeenCalledWith('banner-1');
		expect(mockGetImage).toHaveBeenCalledWith('banner-1');
	});

	it('lets the kiosk cache the image privately until the signed url expires', async () => {
		const response = await GET(event());

		expect(response.headers.get('cache-control')).toBe(
			`private, max-age=${KIOSK_BANNER_URL_TTL_MS / 1000}`
		);
		expect(response.headers.get('pragma')).toBeNull();
	});

	it('shortens the cache lifetime to what is left of the signature', async () => {
		const ev = event();
		vi.setSystemTime(NOW.getTime() + KIOSK_BANNER_URL_TTL_MS - 60_000);
		const response = await GET(ev);

		expect(response.headers.get('cache-control')).toBe('private, max-age=60');
	});

	it('rejects a tampered signature with 403 without touching the repository', async () => {
		const good = event();
		const sig = good.url.searchParams.get('sig') as string;
		const flipped = sig.replace(/^./, (c) => (c === '0' ? '1' : '0'));
		const exp = good.url.searchParams.get('exp');
		const response = await GET(event('banner-1', `?exp=${exp}&sig=${flipped}`));

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('INVALID_SIGNATURE');
		expectNoStore(response);
		expect(mockGetBanner).not.toHaveBeenCalled();
	});

	it('rejects a signature issued for another banner id', async () => {
		const other = event('banner-2');
		const response = await GET({ ...event('banner-1'), url: other.url } as RequestEvent);

		expect(response.status).toBe(403);
		expect(mockGetBanner).not.toHaveBeenCalled();
	});

	it('rejects an expired signature with 403', async () => {
		const ev = event();
		vi.setSystemTime(NOW.getTime() + KIOSK_BANNER_URL_TTL_MS + 1000);
		const response = await GET(ev);

		expect(response.status).toBe(403);
		expectNoStore(response);
		expect(mockGetBanner).not.toHaveBeenCalled();
	});

	it('rejects a missing signature with 403', async () => {
		const response = await GET(event('banner-1', ''));

		expect(response.status).toBe(403);
	});

	it('returns 503 when the url secret is not configured', async () => {
		const ev = event();
		mockEnv.EXTERNAL_API_SECRET = undefined;
		const response = await GET(ev);

		expect(response.status).toBe(503);
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		expectNoStore(response);
	});

	it('returns 503 when the repository fails', async () => {
		mockGetBanner.mockRejectedValueOnce(new Error('couch down'));
		const response = await GET(event());

		expect(response.status).toBe(503);
		expectNoStore(response);
	});

	it.each([
		['banner missing', null, undefined],
		['status inactive', activeBanner({ status: 'inactive' }), undefined],
		['before start_at', activeBanner({ start_at: '2026-10-15T04:00:00.000Z' }), undefined],
		['at or after end_at', activeBanner({ end_at: '2026-10-15T03:00:00.000Z' }), undefined]
	])('returns 404 when %s', async (_label, banner) => {
		mockGetBanner.mockResolvedValueOnce(banner);
		const response = await GET(event());

		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('NOT_FOUND');
		expectNoStore(response);
		expect(mockGetImage).not.toHaveBeenCalled();
	});

	it('returns 404 when the banner has no image attachment', async () => {
		mockGetImage.mockResolvedValueOnce(null);
		const response = await GET(event());

		expect(response.status).toBe(404);
		expectNoStore(response);
	});
});
