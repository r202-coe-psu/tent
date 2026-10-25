import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT } from './+server';
import type { RequestEvent } from './$types';
import { ServiceError, readSessionUserCtx } from '$lib/server/couch-admin';
import { reorderBanners } from '$lib/server/kiosk-banners/kiosk-banner.server';
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
	return { ...actual, reorderBanners: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockReorder = vi.mocked(reorderBanners);

const GROUP = 'kiosk_banner_group:A';
const body = {
	group_id: GROUP,
	screen_type: 'portrait',
	items: [
		{ id: 'kiosk_banner:b2', _rev: '1-b' },
		{ id: 'kiosk_banner:b1', _rev: '1-a' }
	]
};

function put(query: string, payload: unknown): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banners/order${query}`);
	return Promise.resolve(
		PUT({
			request: new Request(url, {
				method: 'PUT',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
				body: JSON.stringify(payload)
			}),
			url
		} as unknown as RequestEvent)
	);
}

describe('PUT /api/back-office/kiosk-banners/order', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockReorder.mockResolvedValue([{ _id: 'kiosk_banner:b2' } as KioskBannerRecord]);
	});

	it('returns 401 / 403 before validating or writing', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await put('?shelter_code=SH001', body)).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await put('?shelter_code=SH001', body)).status).toBe(403);
		expect(mockReorder).not.toHaveBeenCalled();
	});

	it('returns 422 without shelter_code and 403 for another shelter', async () => {
		expect((await put('', body)).status).toBe(422);
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await put('?shelter_code=SH002', body)).status).toBe(403);
		}
		expect(mockReorder).not.toHaveBeenCalled();
	});

	it('returns 422 for a bad body without calling the service', async () => {
		const bad = [
			{ ...body, shelter_code: 'SH002' },
			{ ...body, screen_type: 'landscape' },
			{ screen_type: body.screen_type, items: body.items },
			{ ...body, group_id: 'shelter:A' },
			{ items: body.items },
			{ ...body, items: [{ id: 'kiosk_banner:b1' }] },
			{ ...body, items: [{ id: 'kiosk_banner:b1', _rev: '1-a', order: 1 }] },
			[]
		];
		for (const payload of bad) {
			expect((await put('?shelter_code=SH001', payload)).status).toBe(422);
		}
		expect(mockReorder).not.toHaveBeenCalled();
	});

	it('reorders for the query shelter and returns the records', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await put('?shelter_code=SH001', body);
			expect(response.status).toBe(200);
			expect(await response.json()).toEqual([{ _id: 'kiosk_banner:b2' }]);
			expect(mockReorder).toHaveBeenLastCalledWith(
				'SH001',
				{ groupId: GROUP, screenType: 'portrait' },
				[
					{ id: 'kiosk_banner:b2', rev: '1-b' },
					{ id: 'kiosk_banner:b1', rev: '1-a' }
				]
			);
		}
	});

	it('maps a service CONFLICT to 409', async () => {
		mockReorder.mockRejectedValue(new ServiceError('CONFLICT', 'Banner list changed'));
		expect((await put('?shelter_code=SH001', body)).status).toBe(409);
	});
});
