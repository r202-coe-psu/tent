import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PATCH, PUT } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';
import {
	deleteBanner,
	getBanner,
	setBannerStatus,
	updateBanner
} from '$lib/server/kiosk-banners/kiosk-banner.server';
import type { KioskBannerRecord } from '$lib/server/kiosk-banners/kiosk-banner.server';
import { getGroup } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import type { KioskBannerGroupRecord } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
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
	return {
		...actual,
		getBanner: vi.fn(),
		updateBanner: vi.fn(),
		setBannerStatus: vi.fn(),
		deleteBanner: vi.fn()
	};
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner-group.server')
	>('$lib/server/kiosk-banners/kiosk-banner-group.server');
	return { ...actual, getGroup: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getBanner);
const mockUpdate = vi.mocked(updateBanner);
const mockStatus = vi.mocked(setBannerStatus);
const mockDelete = vi.mocked(deleteBanner);
const mockGetGroup = vi.mocked(getGroup);

const GROUP_MISSING = 'ไม่พบกลุ่มแบนเนอร์ในศูนย์นี้';

function groupRecord(shelter: string): KioskBannerGroupRecord {
	return {
		_id: 'kiosk_banner_group:A',
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: shelter,
		name: 'ตู้หน้าประตู',
		description: null,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'sm-a',
		device_ids: []
	};
}

const ID = '01HZZ';
const DOC_ID = `kiosk_banner:${ID}`;

function record(shelter: string): KioskBannerRecord {
	return {
		_id: DOC_ID,
		_rev: '1-a',
		type: 'kiosk_banner',
		schema_v: 1,
		shelter_code: shelter,
		title: 'ประกาศ',
		caption: null,
		order: 1,
		duration_sec: 10,
		start_at: '2026-10-15T00:00:00.000Z',
		end_at: '2026-11-15T00:00:00.000Z',
		status: 'active',
		created_at: '2026-10-01T00:00:00Z',
		updated_at: '2026-10-01T00:00:00Z',
		created_by: 'sm-a',
		image_content_type: 'image/png'
	};
}

const fields = {
	group_id: 'kiosk_banner_group:A',
	title: 'ใหม่',
	caption: null,
	duration_sec: 12,
	start_at: '2026-10-15T00:00:00.000Z',
	end_at: '2026-11-15T00:00:00.000Z',
	status: 'inactive'
};
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
	'base64'
);

function call(
	handler: typeof GET,
	method: string,
	opts: { query?: string; body?: unknown; id?: string } = {}
): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banners/${ID}${opts.query ?? ''}`);
	return Promise.resolve(
		handler({
			request: new Request(url, {
				method,
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
				body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
			}),
			url,
			params: { id: opts.id ?? ID }
		} as unknown as RequestEvent)
	);
}

const send = {
	GET: () => call(GET, 'GET'),
	PUT: () => call(PUT, 'PUT', { body: { ...fields, _rev: '1-a' } }),
	PATCH: () => call(PATCH, 'PATCH', { body: { _rev: '1-a', status: 'inactive' } }),
	DELETE: () => call(DELETE, 'DELETE', { query: '?rev=1-a' })
};
const writes = () => [mockUpdate, mockStatus, mockDelete];

describe('/api/back-office/kiosk-banners/[id] (FR-KBR-10/12/13)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(record('SH001'));
		mockUpdate.mockResolvedValue(record('SH001'));
		mockStatus.mockResolvedValue(record('SH001'));
		mockDelete.mockResolvedValue(undefined);
		mockGetGroup.mockResolvedValue(groupRecord('SH001'));
	});

	it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
		'%s returns 401 without a session',
		async (m) => {
			mockSession.mockResolvedValue(SESSIONS.anonymous);
			expect((await send[m]()).status).toBe(401);
			expect(mockGet).not.toHaveBeenCalled();
			for (const w of writes()) expect(w).not.toHaveBeenCalled();
		}
	);

	it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
		'%s returns 403 for registration staff',
		async (m) => {
			mockSession.mockResolvedValue(SESSIONS.registrationA);
			expect((await send[m]()).status).toBe(403);
			for (const w of writes()) expect(w).not.toHaveBeenCalled();
		}
	);

	it('serves SM A, kiosk_staff A and SA on a banner of shelter A', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			expect((await send.GET()).status).toBe(200);
			expect((await send.PUT()).status).toBe(200);
			expect((await send.PATCH()).status).toBe(200);
			expect((await send.DELETE()).status).toBe(204);
		}
		expect(mockGet).toHaveBeenCalledWith(DOC_ID);
		expect(mockDelete).toHaveBeenCalledWith(DOC_ID, '1-a');
	});

	it('lets pr_staff read, edit, patch and delete a banner of their own shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await send.GET()).status).toBe(200);
		expect((await send.PUT()).status).toBe(200);
		expect((await send.PATCH()).status).toBe(200);
		expect((await send.DELETE()).status).toBe(204);
		expect(mockDelete).toHaveBeenCalledWith(DOC_ID, '1-a');
	});

	it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
		'%s returns 404 for pr_staff on a banner of another shelter and never writes',
		async (m) => {
			mockSession.mockResolvedValue(SESSIONS.prA);
			mockGet.mockResolvedValue(record('SH002'));
			expect((await send[m]()).status).toBe(404);
			for (const w of writes()) expect(w).not.toHaveBeenCalled();
		}
	);

	it('lets SA manage a banner of any shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockGet.mockResolvedValue(record('SH002'));
		mockGetGroup.mockResolvedValue(groupRecord('SH002'));
		expect((await send.PUT()).status).toBe(200);
	});

	it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
		'%s returns 404 for a banner of another shelter and never writes',
		async (m) => {
			mockGet.mockResolvedValue(record('SH002'));
			for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
				mockSession.mockResolvedValue(session);
				const response = await send[m]();
				expect(response.status).toBe(404);
				if (m !== 'DELETE') expect((await response.json()).error.code).toBe('NOT_FOUND');
			}
			for (const w of writes()) expect(w).not.toHaveBeenCalled();
		}
	);

	it.each(['GET', 'PUT', 'PATCH', 'DELETE'] as const)(
		'%s returns 404 for a missing banner',
		async (m) => {
			mockGet.mockResolvedValue(null);
			expect((await send[m]()).status).toBe(404);
			for (const w of writes()) expect(w).not.toHaveBeenCalled();
		}
	);

	it('reads only banner doc ids: a foreign doc id is a missing banner', async () => {
		mockGet.mockResolvedValue(null);
		await call(GET, 'GET', { id: 'scanner_device:kiosk-01' });
		expect(mockGet).toHaveBeenCalledWith('kiosk_banner:scanner_device:kiosk-01');
	});

	describe('PUT', () => {
		it('passes decoded fields, _rev and the new image to updateBanner', async () => {
			const response = await call(PUT, 'PUT', {
				body: { ...fields, _rev: '1-a', image: { content_type: 'x', data_base64: PNG_B64 } }
			});
			expect(response.status).toBe(200);
			expect(mockUpdate).toHaveBeenCalledWith(
				DOC_ID,
				'1-a',
				expect.objectContaining({ title: 'ใหม่' }),
				expect.objectContaining({ contentType: 'image/png' })
			);
		});

		it('passes screen_type to updateBanner and rejects an unknown one', async () => {
			const response = await call(PUT, 'PUT', {
				body: { ...fields, _rev: '1-a', screen_type: 'portrait' }
			});
			expect(response.status).toBe(200);
			expect(mockUpdate).toHaveBeenCalledWith(
				DOC_ID,
				'1-a',
				expect.objectContaining({ screen_type: 'portrait' }),
				null
			);
			mockUpdate.mockClear();
			const bad = await call(PUT, 'PUT', {
				body: { ...fields, _rev: '1-a', screen_type: 'landscape' }
			});
			expect(bad.status).toBe(422);
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		it('keeps the current image when image is omitted (FR-KBR-05)', async () => {
			await send.PUT();
			expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, '1-a', expect.any(Object), null);
		});

		it('returns 422 for shelter_code in the body, missing _rev, bad fields or bad image', async () => {
			const bodies = [
				{ ...fields, _rev: '1-a', shelter_code: 'SH002' },
				fields,
				{ ...fields, _rev: '1-a', title: '' },
				{ ...fields, _rev: '1-a', image: { content_type: 'image/png', data_base64: '***' } }
			];
			for (const body of bodies) expect((await call(PUT, 'PUT', { body })).status).toBe(422);
			expect(mockGet).not.toHaveBeenCalled();
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		it('validates the body before the scope: 422 even for a banner of another shelter', async () => {
			mockGet.mockResolvedValue(record('SH002'));
			const response = await call(PUT, 'PUT', { body: { ...fields, shelter_code: 'SH001' } });
			expect(response.status).toBe(422);
		});

		it("returns 422 when the group is missing or not in the banner's shelter", async () => {
			mockGetGroup.mockResolvedValue(null);
			const missing = await send.PUT();
			expect(missing.status).toBe(422);
			expect((await missing.json()).error.message).toBe(GROUP_MISSING);
			mockGetGroup.mockResolvedValue(groupRecord('SH002'));
			expect((await send.PUT()).status).toBe(422);
			expect(mockGetGroup).toHaveBeenCalledWith('kiosk_banner_group:A');
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		it('returns 409 when the revision conflicts', async () => {
			mockUpdate.mockRejectedValue(new ServiceError('CONFLICT', 'Banner was modified'));
			const response = await send.PUT();
			expect(response.status).toBe(409);
			expect((await response.json()).error.code).toBe('CONFLICT');
		});
	});

	describe('PATCH', () => {
		it('sets only the status with the given _rev', async () => {
			await send.PATCH();
			expect(mockStatus).toHaveBeenCalledWith(DOC_ID, '1-a', 'inactive');
		});

		it('returns 422 for extra keys, an invalid status or a missing _rev', async () => {
			const bodies = [
				{ _rev: '1-a', status: 'inactive', title: 'x' },
				{ _rev: '1-a', status: 'paused' },
				{ status: 'inactive' }
			];
			for (const body of bodies) expect((await call(PATCH, 'PATCH', { body })).status).toBe(422);
			expect(mockStatus).not.toHaveBeenCalled();
		});

		it('returns 409 when the revision conflicts', async () => {
			mockStatus.mockRejectedValue(new ServiceError('CONFLICT', 'Banner was modified'));
			expect((await send.PATCH()).status).toBe(409);
		});
	});

	describe('DELETE', () => {
		it('returns 422 without ?rev=', async () => {
			expect((await call(DELETE, 'DELETE')).status).toBe(422);
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it('returns 409 when the revision conflicts', async () => {
			mockDelete.mockRejectedValue(new ServiceError('CONFLICT', 'Banner was modified'));
			expect((await send.DELETE()).status).toBe(409);
		});
	});
});
