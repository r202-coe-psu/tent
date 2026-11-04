import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, GET, PUT } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx, ServiceError } from '$lib/server/couch-admin';
import {
	deleteGroup,
	getGroup,
	updateGroup
} from '$lib/server/kiosk-banners/kiosk-banner-group.server';
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
	return { ...actual, getGroup: vi.fn(), updateGroup: vi.fn(), deleteGroup: vi.fn() };
});

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(getGroup);
const mockUpdate = vi.mocked(updateGroup);
const mockDelete = vi.mocked(deleteGroup);

const ID = '01HZZ';
const DOC_ID = `kiosk_banner_group:${ID}`;

function record(shelter: string): KioskBannerGroupRecord {
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
		device_ids: ['kiosk-01']
	};
}

function call(
	handler: typeof GET,
	method: string,
	opts: { query?: string; body?: unknown; id?: string } = {}
): Promise<Response> {
	const url = new URL(
		`http://localhost/api/back-office/kiosk-banner-groups/${ID}${opts.query ?? ''}`
	);
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
	PUT: () => call(PUT, 'PUT', { body: { _rev: '1-a', name: 'ห้องอาหาร', description: 'ชั้น 1' } }),
	DELETE: () => call(DELETE, 'DELETE', { query: '?rev=1-a' })
};
const METHODS = ['GET', 'PUT', 'DELETE'] as const;
const writes = () => [mockUpdate, mockDelete];

describe('/api/back-office/kiosk-banner-groups/[id]', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue(record('SH001'));
		mockUpdate.mockResolvedValue(record('SH001'));
		mockDelete.mockResolvedValue(undefined);
	});

	it.each(METHODS)('%s returns 401 without a session', async (m) => {
		mockSession.mockResolvedValue(SESSIONS.anonymous);
		expect((await send[m]()).status).toBe(401);
		expect(mockGet).not.toHaveBeenCalled();
		for (const w of writes()) expect(w).not.toHaveBeenCalled();
	});

	it.each(METHODS)('%s returns 403 for registration staff', async (m) => {
		mockSession.mockResolvedValue(SESSIONS.registrationA);
		expect((await send[m]()).status).toBe(403);
		for (const w of writes()) expect(w).not.toHaveBeenCalled();
	});

	it('serves SM A, kiosk_staff A and SA on a group of shelter A', async () => {
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA, SESSIONS.admin]) {
			mockSession.mockResolvedValue(session);
			const got = await send.GET();
			expect(got.status).toBe(200);
			expect((await got.json())._id).toBe(DOC_ID);
			expect((await send.PUT()).status).toBe(200);
			expect((await send.DELETE()).status).toBe(204);
		}
		expect(mockGet).toHaveBeenCalledWith(DOC_ID);
		expect(mockDelete).toHaveBeenLastCalledWith(DOC_ID, '1-a', 'sa-user');
	});

	it('lets pr_staff read, edit and delete a group of their own shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		expect((await send.GET()).status).toBe(200);
		expect((await send.PUT()).status).toBe(200);
		expect((await send.DELETE()).status).toBe(204);
		expect(mockDelete).toHaveBeenLastCalledWith(DOC_ID, '1-a', 'pr-a');
	});

	it.each(METHODS)('%s returns 404 for pr_staff on a group of another shelter', async (m) => {
		mockSession.mockResolvedValue(SESSIONS.prA);
		mockGet.mockResolvedValue(record('SH002'));
		expect((await send[m]()).status).toBe(404);
		for (const w of writes()) expect(w).not.toHaveBeenCalled();
	});

	it.each(METHODS)('%s returns 404 for a group of another shelter and never writes', async (m) => {
		mockGet.mockResolvedValue(record('SH002'));
		for (const session of [SESSIONS.managerA, SESSIONS.kioskA]) {
			mockSession.mockResolvedValue(session);
			expect((await send[m]()).status).toBe(404);
		}
		for (const w of writes()) expect(w).not.toHaveBeenCalled();
	});

	it.each(METHODS)('%s returns 404 for a missing group', async (m) => {
		mockGet.mockResolvedValue(null);
		const res = await send[m]();
		expect(res.status).toBe(404);
		expect(await res.json()).toEqual({
			error: { code: 'NOT_FOUND', message: 'Banner group not found' }
		});
		for (const w of writes()) expect(w).not.toHaveBeenCalled();
	});

	it('reads only group doc ids: a foreign doc id is a missing group', async () => {
		mockGet.mockResolvedValue(null);
		await call(GET, 'GET', { id: 'scanner_device:kiosk-01' });
		expect(mockGet).toHaveBeenCalledWith('kiosk_banner_group:scanner_device:kiosk-01');
	});

	describe('PUT', () => {
		it('passes _rev and the parsed fields to updateGroup', async () => {
			await send.PUT();
			expect(mockUpdate).toHaveBeenCalledWith(DOC_ID, '1-a', {
				name: 'ห้องอาหาร',
				description: 'ชั้น 1'
			});
		});

		it('returns 422 for a missing _rev, a bad name, shelter_code or device_ids in the body', async () => {
			const bad = [
				{ name: 'x' },
				{ _rev: '1-a', name: '' },
				{ _rev: '1-a', name: 'x', shelter_code: 'SH002' },
				{ _rev: '1-a', name: 'x', device_ids: [] }
			];
			for (const body of bad) {
				expect((await call(PUT, 'PUT', { body })).status).toBe(422);
			}
			expect(mockUpdate).not.toHaveBeenCalled();
		});

		it('maps a CONFLICT from the module to 409 with its message', async () => {
			mockUpdate.mockRejectedValue(new ServiceError('CONFLICT', 'ชื่อกลุ่มซ้ำ'));
			const response = await send.PUT();
			expect(response.status).toBe(409);
			expect((await response.json()).error.message).toBe('ชื่อกลุ่มซ้ำ');
		});
	});

	describe('DELETE', () => {
		it('passes the rev and the caller name to deleteGroup', async () => {
			expect((await send.DELETE()).status).toBe(204);
			expect(mockDelete).toHaveBeenCalledWith(DOC_ID, '1-a', 'sm-a');
		});

		it('returns 422 without rev', async () => {
			expect((await call(DELETE, 'DELETE')).status).toBe(422);
			expect(mockDelete).not.toHaveBeenCalled();
		});

		it('maps a CONFLICT (group still has banners) to 409 with its message', async () => {
			mockDelete.mockRejectedValue(
				new ServiceError('CONFLICT', 'ลบกลุ่มไม่ได้ ยังมีแบนเนอร์ในกลุ่ม')
			);
			const response = await send.DELETE();
			expect(response.status).toBe(409);
			expect((await response.json()).error.message).toBe('ลบกลุ่มไม่ได้ ยังมีแบนเนอร์ในกลุ่ม');
		});
	});
});
