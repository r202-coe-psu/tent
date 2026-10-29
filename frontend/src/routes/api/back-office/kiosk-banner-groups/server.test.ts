import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';
import { createGroup, listGroups } from '$lib/server/kiosk-banners/kiosk-banner-group.server';
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
	return { ...actual, listGroups: vi.fn(), createGroup: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockList = vi.mocked(listGroups);
const mockCreate = vi.mocked(createGroup);

function group(name: string): KioskBannerGroupRecord {
	return {
		_id: `kiosk_banner_group:${name}`,
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH001',
		name,
		description: null,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'sm-a',
		device_ids: []
	};
}

describe('GET /api/back-office/kiosk-banner-groups', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockList.mockResolvedValue([group('ห้องอาหาร'), group('ก-ประตู'), group('ข-ลาน')]);
	});

	function get(query: string): Promise<Response> {
		const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups${query}`);
		return Promise.resolve(
			GET({
				request: new Request(url, { headers: { cookie: 'AuthSession=x' } }),
				url
			} as unknown as RequestEvent)
		);
	}

	it('lists the shelter groups sorted by name', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await get('?shelter_code=SH001');
			expect(response.status).toBe(200);
			expect(((await response.json()) as KioskBannerGroupRecord[]).map((g) => g.name)).toEqual([
				'ก-ประตู',
				'ข-ลาน',
				'ห้องอาหาร'
			]);
		}
		expect(mockList).toHaveBeenCalledWith('SH001');
	});

	it('lets pr_staff list their own shelter groups and 403 for another', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await get('?shelter_code=SH001')).status).toBe(200);
		expect((await get('?shelter_code=SH002')).status).toBe(403);
		expect(mockList).toHaveBeenCalledTimes(1);
	});

	it('returns 401 without a session and 403 for registration staff', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await get('?shelter_code=SH001')).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await get('?shelter_code=SH001')).status).toBe(403);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 422 without shelter_code, even for SA', async () => {
		mockSession.mockResolvedValue(SESSIONS.admin);
		expect((await get('')).status).toBe(422);
		expect(mockList).not.toHaveBeenCalled();
	});

	it('returns 403 for a shelter outside the caller scope, without reading', async () => {
		expect((await get('?shelter_code=SH002')).status).toBe(403);
		expect(mockList).not.toHaveBeenCalled();
	});
});

describe('POST /api/back-office/kiosk-banner-groups', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockCreate.mockResolvedValue(group('new'));
	});

	function post(query: string, body: unknown): Promise<Response> {
		const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups${query}`);
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

	it('creates for the query shelter as the caller and returns 201', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const response = await post('?shelter_code=SH001', {
				name: 'ตู้หน้าประตู',
				description: 'หน้าศูนย์',
				device_ids: ['kiosk-01']
			});
			expect(response.status).toBe(201);
			expect(mockCreate).toHaveBeenLastCalledWith(
				{ name: 'ตู้หน้าประตู', description: 'หน้าศูนย์' },
				['kiosk-01'],
				{ shelterCode: 'SH001', createdBy: session.name }
			);
		}
	});

	it('lets pr_staff create a group in their own shelter and 403 for another', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await post('?shelter_code=SH001', { name: 'ตู้ PR' })).status).toBe(201);
		expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'ตู้ PR' }), [], {
			shelterCode: 'SH001',
			createdBy: 'pr-a'
		});
		expect((await post('?shelter_code=SH002', { name: 'ตู้ PR' })).status).toBe(403);
		expect(mockCreate).toHaveBeenCalledTimes(1);
	});

	it('defaults device_ids to an empty list', async () => {
		await post('?shelter_code=SH001', { name: 'ว่าง' });
		expect(mockCreate).toHaveBeenLastCalledWith(expect.objectContaining({ name: 'ว่าง' }), [], {
			shelterCode: 'SH001',
			createdBy: 'sm-a'
		});
	});

	it('returns 401 / 403 before writing, and 403 for another shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await post('?shelter_code=SH001', { name: 'x' })).status).toBe(401);
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await post('?shelter_code=SH001', { name: 'x' })).status).toBe(403);
		mockSession.mockResolvedValue(SESSIONS.managerA);
		expect((await post('?shelter_code=SH002', { name: 'x' })).status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 without shelter_code', async () => {
		expect((await post('', { name: 'x' })).status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 when the body carries shelter_code or an unknown key', async () => {
		expect((await post('?shelter_code=SH001', { name: 'x', shelter_code: 'SH002' })).status).toBe(
			422
		);
		expect((await post('?shelter_code=SH001', { name: 'x', extra: 1 })).status).toBe(422);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('returns 422 with the Thai schema message for an invalid name or device_ids', async () => {
		const response = await post('?shelter_code=SH001', { name: '   ' });
		expect(response.status).toBe(422);
		expect((await response.json()).error.message).toBe('ระบุชื่อกลุ่ม');
		expect((await post('?shelter_code=SH001', { name: 'x', device_ids: 'kiosk-01' })).status).toBe(
			422
		);
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('maps a CONFLICT from the module to 409 with its message', async () => {
		mockCreate.mockRejectedValue(
			new ServiceError('CONFLICT', 'ชื่อกลุ่มซ้ำกับกลุ่มอื่นในศูนย์นี้')
		);
		const response = await post('?shelter_code=SH001', { name: 'ซ้ำ' });
		expect(response.status).toBe(409);
		expect((await response.json()).error.message).toBe('ชื่อกลุ่มซ้ำกับกลุ่มอื่นในศูนย์นี้');
	});
});
