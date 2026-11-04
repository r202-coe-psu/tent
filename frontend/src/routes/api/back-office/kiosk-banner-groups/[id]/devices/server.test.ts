import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';
import { getGroup, setGroupDevices } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import type { KioskBannerGroupRecord } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/kiosk-banners/kiosk-banner-group.server', async () => {
	const actual = await vi.importActual<
		typeof import('$lib/server/kiosk-banners/kiosk-banner-group.server')
	>('$lib/server/kiosk-banners/kiosk-banner-group.server');
	return { ...actual, getGroup: vi.fn(), setGroupDevices: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getGroup);
const mockSet = vi.mocked(setGroupDevices);

const ID = '01HZZ';
const DOC_ID = `kiosk_banner_group:${ID}`;

function record(shelter: string, deviceIds: string[] = []): KioskBannerGroupRecord {
	return {
		_id: DOC_ID,
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: shelter,
		name: 'ตู้หน้าประตู',
		description: null,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'sm-a',
		device_ids: deviceIds
	};
}

function put(body: unknown): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups/${ID}/devices`);
	return Promise.resolve(
		PUT({
			request: new Request(url, {
				method: 'PUT',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
				body: JSON.stringify(body)
			}),
			url,
			params: { id: ID }
		} as unknown as RequestEvent)
	);
}

describe('PUT /api/back-office/kiosk-banner-groups/[id]/devices', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(record('SH001'));
		mockSet.mockResolvedValue(record('SH001', ['kiosk-01', 'kiosk-02']));
	});

	it('sets the group devices as the caller and returns the updated record', async () => {
		const response = await put({ device_ids: ['kiosk-01', 'kiosk-02'] });
		expect(response.status).toBe(200);
		expect((await response.json()).device_ids).toEqual(['kiosk-01', 'kiosk-02']);
		expect(mockGet).toHaveBeenCalledWith(DOC_ID);
		expect(mockSet).toHaveBeenCalledWith(record('SH001'), ['kiosk-01', 'kiosk-02'], 'sm-a');
	});

	it('lets pr_staff set devices of a group in their own shelter, 404 for another', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await put({ device_ids: ['kiosk-01'] })).status).toBe(200);
		expect(mockSet).toHaveBeenCalledWith(record('SH001'), ['kiosk-01'], 'pr-a');
		mockSet.mockClear();
		mockGet.mockResolvedValue(record('SH002'));
		expect((await put({ device_ids: ['kiosk-01'] })).status).toBe(404);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('accepts an empty list (free every device)', async () => {
		expect((await put({ device_ids: [] })).status).toBe(200);
		expect(mockSet).toHaveBeenCalledWith(expect.anything(), [], 'sm-a');
	});

	it('returns 401 / 403 before reading or writing', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await put({ device_ids: [] })).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await put({ device_ids: [] })).status).toBe(403);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('returns 404 for a group of another shelter or a missing group, without writing', async () => {
		mockGet.mockResolvedValue(record('SH002'));
		expect((await put({ device_ids: [] })).status).toBe(404);
		mockGet.mockResolvedValue(null);
		expect((await put({ device_ids: [] })).status).toBe(404);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('returns 422 for a malformed body', async () => {
		const bad = [{}, { device_ids: 'kiosk-01' }, { device_ids: [1] }, { device_ids: [], x: 1 }];
		for (const body of bad) expect((await put(body)).status).toBe(422);
		expect(mockSet).not.toHaveBeenCalled();
	});

	it('maps a VALIDATION from the module (device not in shelter) to 422 with its message', async () => {
		mockSet.mockRejectedValue(
			new ServiceError('VALIDATION', 'อุปกรณ์ไม่ได้อยู่ในศูนย์ของกลุ่มนี้')
		);
		const response = await put({ device_ids: ['other'] });
		expect(response.status).toBe(422);
		expect((await response.json()).error.message).toBe('อุปกรณ์ไม่ได้อยู่ในศูนย์ของกลุ่มนี้');
	});
});
