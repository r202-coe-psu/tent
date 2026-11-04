import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { authorizeUserWrite } from '$lib/server/couch-admin';
import { getFooterLogoImage } from '$lib/server/public-portal/footer-logos.server';

vi.mock('$lib/server/couch-admin', () => ({ authorizeUserWrite: vi.fn() }));
vi.mock('$lib/server/public-portal/footer-logos.server', () => ({ getFooterLogoImage: vi.fn() }));

const mockAuthorize = vi.mocked(authorizeUserWrite);
const mockGetImage = vi.mocked(getFooterLogoImage);

const BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47]).buffer;

function event(id = 'logo-1'): RequestEvent {
	const url = new URL(`http://localhost/api/public/v1/config/footer-logos/${id}/image?v=md5-x`);
	return {
		params: { id },
		url,
		request: new Request(url, { headers: { cookie: 'AuthSession=x' } })
	} as unknown as RequestEvent;
}

beforeEach(() => {
	mockAuthorize.mockReset();
	mockGetImage.mockReset();
});

describe('GET /api/public/v1/config/footer-logos/[id]/image', () => {
	it('serves a published logo with a public cache header', async () => {
		mockGetImage.mockResolvedValueOnce({ bytes: BYTES, contentType: 'image/webp' });

		const res = await GET(event());

		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toBe('public, max-age=3600');
		expect(res.headers.get('x-content-type-options')).toBe('nosniff');
		expect(mockAuthorize).not.toHaveBeenCalled();
	});

	it('returns 404 for a hidden or unknown logo to anonymous callers', async () => {
		mockGetImage.mockResolvedValue(null);
		mockAuthorize.mockRejectedValueOnce(new Error('unauthenticated'));

		const res = await GET(event());

		expect(res.status).toBe(404);
		expect(mockGetImage).toHaveBeenCalledTimes(1);
	});

	it('lets SA preview a hidden logo without caching it', async () => {
		mockGetImage
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ bytes: BYTES, contentType: 'image/png' });
		mockAuthorize.mockResolvedValueOnce({ isSA: true } as never);

		const res = await GET(event());

		expect(res.status).toBe(200);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(mockGetImage).toHaveBeenLastCalledWith('logo-1', { includeUnpublished: true });
	});

	it('returns 404 to a shelter_manager for a hidden logo (SA-only preview, CR-184 Q6)', async () => {
		mockGetImage.mockResolvedValue(null);
		mockAuthorize.mockResolvedValueOnce({ isSA: false } as never);

		const res = await GET(event());

		expect(res.status).toBe(404);
		expect(mockGetImage).toHaveBeenCalledTimes(1);
		expect(mockGetImage).not.toHaveBeenCalledWith('logo-1', { includeUnpublished: true });
	});

	it('returns 503 when CouchDB is unavailable', async () => {
		mockGetImage.mockRejectedValueOnce(new Error('down'));

		const res = await GET(event());

		expect(res.status).toBe(503);
	});
});
