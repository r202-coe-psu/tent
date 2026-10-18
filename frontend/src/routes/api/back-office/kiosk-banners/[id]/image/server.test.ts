import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import { getBanner, getBannerImage } from '$lib/server/kiosk-banners/kiosk-banner.server';
import type { KioskBannerRecord } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner.server')
	>('$lib/server/kiosk-banners/kiosk-banner.server');
	return { ...actual, getBanner: vi.fn(), getBannerImage: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getBanner);
const mockImage = vi.mocked(getBannerImage);

const banner = (shelter: string) =>
	({ _id: 'kiosk_banner:01', shelter_code: shelter }) as KioskBannerRecord;

function get(): Promise<Response> {
	return Promise.resolve(
		GET({
			request: new Request('http://localhost/api/back-office/kiosk-banners/01/image', {
				headers: { cookie: 'AuthSession=x' }
			}),
			params: { id: '01' }
		} as unknown as RequestEvent)
	);
}

describe('GET /api/back-office/kiosk-banners/[id]/image (FR-KBR-10/12)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(banner('SH001'));
		mockImage.mockResolvedValue({
			bytes: new Uint8Array([1, 2, 3]).buffer,
			contentType: 'image/png'
		});
	});

	it('returns 401 / 403 without reading the banner', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await get()).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await get()).status).toBe(403);
		expect(mockGet).not.toHaveBeenCalled();
		expect(mockImage).not.toHaveBeenCalled();
	});

	it('streams the bytes with the stored content type, uncached', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await get();
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('image/png');
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
		}
	});

	it('returns 404 for a banner of another shelter without reading the image', async () => {
		mockGet.mockResolvedValue(banner('SH002'));
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await get()).status).toBe(404);
		}
		expect(mockImage).not.toHaveBeenCalled();
	});

	it('returns 404 for a missing banner or a missing image', async () => {
		mockGet.mockResolvedValue(null);
		expect((await get()).status).toBe(404);
		mockGet.mockResolvedValue(banner('SH001'));
		mockImage.mockResolvedValue(null);
		const response = await get();
		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('NOT_FOUND');
	});
});
