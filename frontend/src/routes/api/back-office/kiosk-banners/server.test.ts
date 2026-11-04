import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import { createBanner, listBannersForShelter } from '$lib/server/kiosk-banners/kiosk-banner.server';
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
	return { ...actual, listBannersForShelter: vi.fn(), createBanner: vi.fn() };
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner-group.server')
	>('$lib/server/kiosk-banners/kiosk-banner-group.server');
	return { ...actual, getGroup: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockList = vi.mocked(listBannersForShelter);
const mockCreate = vi.mocked(createBanner);
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

const NOW = new Date('2026-10-15T00:00:00Z');

function record(id: string, start: string, end: string): KioskBannerRecord {
	return {
		_id: `kiosk_banner:${id}`,
		_rev: '1-a',
		type: 'kiosk_banner',
		schema_v: 1,
		shelter_code: 'SH001',
		title: id,
		caption: null,
		order: 1,
		duration_sec: 10,
		start_at: start,
		end_at: end,
		status: 'active',
		created_at: '2026-10-01T00:00:00Z',
		updated_at: '2026-10-01T00:00:00Z',
		created_by: 'sm-a',
		image_content_type: 'image/png'
	};
}

// PNG signature + padding, base64 canonical.
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString(
	'base64'
);

describe('GET /api/back-office/kiosk-banners (FR-KBR-10/11)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(NOW);
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockList.mockResolvedValue([
			record('late', '2026-11-01T00:00:00Z', '2026-12-01T00:00:00Z'),
			record('live', '2026-10-01T00:00:00Z', '2026-11-01T00:00:00Z'),
			record('old1', '2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z'),
			record('old2', '2026-09-01T00:00:00Z', '2026-10-01T00:00:00Z')
		]);
	});

	function get(query: string): Promise<Response> {
		const url = new URL(`http://localhost/api/back-office/kiosk-banners${query}`);
		return Promise.resolve(
			GET({
				request: new Request(url, { headers: { cookie: 'AuthSession=x' } }),
				url
			} as unknown as RequestEvent)
		);
	}

	it('returns 401 without a session', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await get('?shelter_code=SH001')).status).toBe(401);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 403 for registration staff', async () => {
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await get('?shelter_code=SH001')).status).toBe(403);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 422 when shelter_code is missing, even for SA', async () => {
		mockSession.mockResolvedValue(SESSIONS.admin);
		const response = await get('');
		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 403 for a shelter outside the caller scope, without reading registry', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await get('?shelter_code=SH002')).status).toBe(403);
		}
		expect(mockList).not.toHaveBeenCalled();
	});

	it('lists the current view by default for SM, kiosk_staff and SA', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await get('?shelter_code=SH001');
			expect(response.status).toBe(200);
			const body = (await response.json()) as KioskBannerRecord[];
			expect(body.map((b) => b.title)).toEqual(['live', 'late']);
		}
		expect(mockList).toHaveBeenCalledWith('SH001');
	});

	it('lets pr_staff list the banners of their own shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		const response = await get('?shelter_code=SH001');
		expect(response.status).toBe(200);
		expect(((await response.json()) as KioskBannerRecord[]).map((b) => b.title)).toEqual([
			'live',
			'late'
		]);
	});

	it('returns 403 for pr_staff listing another shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		const response = await get('?shelter_code=SH002');
		expect(response.status).toBe(403);
		expect((await response.json()).error.message).toContain('pr_staff');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('lists expired banners newest end first', async () => {
		const response = await get('?shelter_code=SH001&view=expired');
		expect(response.status).toBe(200);
		expect(((await response.json()) as KioskBannerRecord[]).map((b) => b.title)).toEqual([
			'old2',
			'old1'
		]);
	});

	it('returns 422 for an unknown view', async () => {
		expect((await get('?shelter_code=SH001&view=all')).status).toBe(422);
		expect(mockList).not.toHaveBeenCalled();
	});
});

describe('POST /api/back-office/kiosk-banners (FR-KBR-02/04/11)', () => {
	const input = {
		group_id: 'kiosk_banner_group:A',
		title: 'ประกาศ',
		caption: null,
		duration_sec: 10,
		start_at: '2026-10-15T00:00:00.000Z',
		end_at: '2026-11-15T00:00:00.000Z',
		status: 'active'
	};
	const image = { content_type: 'image/png', data_base64: PNG_B64 };

	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockCreate.mockResolvedValue(record('new', input.start_at, input.end_at));
		mockGetGroup.mockResolvedValue(groupRecord('SH001'));
	});

	function post(query: string, body: unknown): Promise<Response> {
		const url = new URL(`http://localhost/api/back-office/kiosk-banners${query}`);
		return Promise.resolve(
			POST({
				request: new Request(url, {
					method: 'POST',
					headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
					body: JSON.stringify(body)
				}),
				url
			} as unknown as RequestEvent)
		);
	}

	it('returns 401 / 403 before validating or writing', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await post('?shelter_code=SH001', { ...input, image })).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await post('?shelter_code=SH001', { ...input, image })).status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 without shelter_code and 403 for another shelter', async () => {
		expect((await post('', { ...input, image })).status).toBe(422);
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await post('?shelter_code=SH002', { ...input, image })).status).toBe(403);
		}
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('creates for the query shelter as the caller and returns 201', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await post('?shelter_code=SH001', { ...input, image });
			expect(response.status).toBe(201);
			expect(mockCreate).toHaveBeenLastCalledWith(
				expect.objectContaining({ title: 'ประกาศ' }),
				expect.objectContaining({ contentType: 'image/png' }),
				{ shelterCode: 'SH001', createdBy: session.name }
			);
		}
	});

	it('lets pr_staff create for their own shelter as themselves', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		const response = await post('?shelter_code=SH001', { ...input, image });
		expect(response.status).toBe(201);
		expect(mockCreate).toHaveBeenLastCalledWith(
			expect.objectContaining({ title: 'ประกาศ' }),
			expect.objectContaining({ contentType: 'image/png' }),
			{ shelterCode: 'SH001', createdBy: 'pr-a' }
		);
	});

	it('returns 403 for pr_staff creating in another shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await post('?shelter_code=SH002', { ...input, image })).status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('passes screen_type through, defaulting to compact', async () => {
		await post('?shelter_code=SH001', { ...input, image, screen_type: 'portrait' });
		expect(mockCreate).toHaveBeenLastCalledWith(
			expect.objectContaining({ screen_type: 'portrait' }),
			expect.anything(),
			expect.anything()
		);
		await post('?shelter_code=SH001', { ...input, image });
		expect(mockCreate).toHaveBeenLastCalledWith(
			expect.objectContaining({ screen_type: 'compact' }),
			expect.anything(),
			expect.anything()
		);
	});

	it('returns 422 for an unknown screen_type', async () => {
		const response = await post('?shelter_code=SH001', {
			...input,
			image,
			screen_type: 'landscape'
		});
		expect(response.status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 when the body carries shelter_code', async () => {
		const response = await post('?shelter_code=SH001', { ...input, image, shelter_code: 'SH002' });
		expect(response.status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 for invalid fields or a missing image', async () => {
		expect((await post('?shelter_code=SH001', { ...input, image, title: '' })).status).toBe(422);
		expect((await post('?shelter_code=SH001', input)).status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 with a Thai message for a bad image', async () => {
		const bad = [
			{ content_type: 'image/png', data_base64: '' },
			{ content_type: 'image/png', data_base64: '***' },
			{ content_type: 'image/png', data_base64: Buffer.from('hello world!').toString('base64') }
		];
		for (const badImage of bad) {
			const response = await post('?shelter_code=SH001', { ...input, image: badImage });
			expect(response.status).toBe(422);
			expect((await response.json()).error.message).toMatch(/[฀-๿]/);
		}
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 when the group is missing or belongs to another shelter', async () => {
		mockGetGroup.mockResolvedValue(null);
		const missing = await post('?shelter_code=SH001', { ...input, image });
		expect(missing.status).toBe(422);
		expect((await missing.json()).error.message).toBe(GROUP_MISSING);
		mockGetGroup.mockResolvedValue(groupRecord('SH002'));
		expect((await post('?shelter_code=SH001', { ...input, image })).status).toBe(422);
		expect(mockGetGroup).toHaveBeenCalledWith('kiosk_banner_group:A');
		expect(mockCreate).not.toHaveBeenCalled();
	});
});
