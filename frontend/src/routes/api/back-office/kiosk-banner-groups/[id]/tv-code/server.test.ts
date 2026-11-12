import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/session-auth';
import { getGroup, rotateTvCode } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import type { KioskBannerGroupRecord } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/session-auth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session-auth')>(
		'$lib/server/session-auth'
	);
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner-group.server')
	>('$lib/server/kiosk-banners/kiosk-banner-group.server');
	return { ...actual, getGroup: vi.fn(), rotateTvCode: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getGroup);
const mockRotate = vi.mocked(rotateTvCode);

const ID = '01HZZ';
const DOC_ID = `kiosk_banner_group:${ID}`;

function record(shelter: string, tvCode = 'OLD123'): KioskBannerGroupRecord {
	return {
		_id: DOC_ID,
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 2,
		shelter_code: shelter,
		name: 'ตู้หน้าประตู',
		description: null,
		tv_code: tvCode,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'sm-a',
		device_ids: []
	};
}

function post(): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups/${ID}/tv-code`);
	return Promise.resolve(
		POST({
			request: new Request(url, { method: 'POST', headers: { cookie: 'AuthSession=x' } }),
			url,
			params: { id: ID }
		} as unknown as RequestEvent)
	);
}

describe('POST /api/back-office/kiosk-banner-groups/[id]/tv-code', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(record('SH001'));
		mockRotate.mockResolvedValue(record('SH001', 'NEW456'));
	});

	it("a banner manager of the group's shelter rotates the code and gets the group back with the new tv_code", async () => {
		const response = await post();
		expect(response.status).toBe(200);
		expect((await response.json()).tv_code).toBe('NEW456');
		expect(mockRotate).toHaveBeenCalledWith(DOC_ID);
	});

	it("a manager of another shelter cannot rotate a group's code (404, like the sibling routes)", async () => {
		mockGet.mockResolvedValue(record('SH002'));
		expect((await post()).status).toBe(404);
		expect(mockRotate).not.toHaveBeenCalled();
	});

	it('rejects a caller without banner-manager capability (403) or without a session (401)', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await post()).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await post()).status).toBe(403);
		expect(mockRotate).not.toHaveBeenCalled();
	});

	it('returns 404 for an unknown group id', async () => {
		mockGet.mockResolvedValue(null);
		expect((await post()).status).toBe(404);
		expect(mockRotate).not.toHaveBeenCalled();
	});
});
