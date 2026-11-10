import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, PUT } from './+server';
import { PUT as PUT_DEVICES } from './devices/+server';
import type { RequestEvent } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import { readSessionUserCtx } from '$lib/server/session-auth';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/session-auth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session-auth')>(
		'$lib/server/session-auth'
	);
	return { ...actual, readSessionUserCtx: vi.fn() };
});
vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn()
}));
vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { listDevices: vi.fn(), setBannerGroup: vi.fn() }
}));

const mockSession = vi.mocked(readSessionUserCtx);
const mockAdminRaw = vi.mocked(adminRaw);
const mockListDevices = vi.mocked(scannerDeviceRepository.listDevices);

const ID = '01HZZ';
const DOC_ID = `kiosk_banner_group:${ID}`;

const v1Group = (shelter: string) => ({
	_id: DOC_ID,
	_rev: '1-a',
	type: 'kiosk_banner_group',
	schema_v: 1,
	shelter_code: shelter,
	name: 'ตู้หน้าประตู',
	description: null,
	created_at: '2026-10-01T00:00:00.000Z',
	updated_at: '2026-10-01T00:00:00.000Z',
	created_by: 'sm-a'
});

const puts = () => mockAdminRaw.mock.calls.filter(([, method]) => method === 'PUT');

function get(): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups/${ID}`);
	return Promise.resolve(
		GET({
			request: new Request(url, { headers: { cookie: 'AuthSession=x' } }),
			url,
			params: { id: ID }
		} as unknown as RequestEvent)
	);
}

describe('GET /api/back-office/kiosk-banner-groups/[id] tv_code backfill', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockListDevices.mockResolvedValue([]);
	});

	it('a manager of another shelter GETting a v1 group gets 404 and the group is not written', async () => {
		mockAdminRaw.mockImplementation(async (_path, method) =>
			method === 'GET'
				? { status: 200, data: v1Group('SH002') }
				: method === 'POST'
					? { status: 200, data: { docs: [] } }
					: { status: 201, data: { ok: true, rev: '2-b' } }
		);

		expect((await get()).status).toBe(404);

		expect(puts()).toHaveLength(0);
	});

	it('an in-scope GET of a v1 group returns it with a tv_code', async () => {
		mockAdminRaw
			.mockResolvedValueOnce({ status: 200, data: v1Group('SH001') })
			.mockResolvedValueOnce({ status: 200, data: { docs: [] } })
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '2-b' } });
		mockListDevices.mockResolvedValue([
			{ device_id: 'kiosk-1', banner_group_id: DOC_ID }
		] as unknown as Awaited<ReturnType<typeof scannerDeviceRepository.listDevices>>);

		const res = await get();

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			_id: DOC_ID,
			_rev: '2-b',
			schema_v: 2,
			tv_code: expect.stringMatching(/^[0-9]{6}$/),
			device_ids: ['kiosk-1']
		});
		expect(puts()).toHaveLength(1);
	});
});

function putJson(
	handler: typeof PUT | typeof PUT_DEVICES,
	path: string,
	body: unknown
): Promise<Response> {
	const url = new URL(`http://localhost/api/back-office/kiosk-banner-groups/${ID}${path}`);
	return Promise.resolve(
		handler({
			request: new Request(url, {
				method: 'PUT',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=x' },
				body: JSON.stringify(body)
			}),
			url,
			params: { id: ID }
		} as unknown as RequestEvent & Parameters<typeof PUT_DEVICES>[0])
	);
}

describe('PUT routes on a v1 group backfill tv_code (FR-KBT-12)', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockListDevices.mockResolvedValue([]);
		mockAdminRaw.mockImplementation(async (_path, method) =>
			method === 'GET'
				? { status: 200, data: v1Group('SH001') }
				: method === 'POST'
					? { status: 200, data: { docs: [] } }
					: { status: 201, data: { ok: true, rev: '2-b' } }
		);
	});

	it('PUT [id] (rename) returns schema_v 2 with a tv_code', async () => {
		const res = await putJson(PUT, '', { _rev: '1-a', name: 'ชื่อใหม่', description: null });

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			schema_v: 2,
			name: 'ชื่อใหม่',
			tv_code: expect.stringMatching(/^[0-9]{6}$/)
		});
		expect(puts()).toHaveLength(1);
	});

	it('PUT [id]/devices returns schema_v 2 with a tv_code', async () => {
		const res = await putJson(PUT_DEVICES, '/devices', { device_ids: [] });

		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({
			schema_v: 2,
			tv_code: expect.stringMatching(/^[0-9]{6}$/)
		});
		expect(puts()).toHaveLength(1);
	});
});
