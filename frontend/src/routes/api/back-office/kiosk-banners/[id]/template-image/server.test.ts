import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/session-auth';
import { getBanner, getBannerTemplateImage } from '$lib/server/kiosk-banners/kiosk-banner.server';
import type { KioskBannerRecord } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/session-auth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session-auth')>(
		'$lib/server/session-auth'
	);
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner.server')
	>('$lib/server/kiosk-banners/kiosk-banner.server');
	return { ...actual, getBanner: vi.fn(), getBannerTemplateImage: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getBanner);
const mockImage = vi.mocked(getBannerTemplateImage);

const banner = (shelter: string) =>
	({ _id: 'kiosk_banner:01', shelter_code: shelter }) as KioskBannerRecord;

function get(): Promise<Response> {
	return Promise.resolve(
		GET({
			request: new Request('http://localhost/api/back-office/kiosk-banners/01/template-image', {
				headers: { cookie: 'AuthSession=x' }
			}),
			params: { id: '01' }
		} as unknown as RequestEvent)
	);
}

describe('GET /api/back-office/kiosk-banners/[id]/template-image', () => {
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

	it('streams the logo bytes with the stored content type, uncached', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await get();
			expect(response.status).toBe(200);
			expect(response.headers.get('content-type')).toBe('image/png');
			expect(response.headers.get('cache-control')).toBe('private, no-store');
			expect(response.headers.get('x-content-type-options')).toBe('nosniff');
			expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
		}
		expect(mockImage).toHaveBeenCalledWith('kiosk_banner:01');
	});

	it('returns 404 for a banner of another shelter without reading the logo', async () => {
		mockGet.mockResolvedValue(banner('SH002'));
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await get()).status).toBe(404);
		}
		expect(mockImage).not.toHaveBeenCalled();
	});

	it('returns 404 for a missing banner or a banner without a logo', async () => {
		mockGet.mockResolvedValue(null);
		expect((await get()).status).toBe(404);
		mockGet.mockResolvedValue(banner('SH001'));
		mockImage.mockResolvedValue(null);
		const response = await get();
		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('NOT_FOUND');
	});
});
