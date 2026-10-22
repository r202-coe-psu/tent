import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET, POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: {
		createDevice: vi.fn(),
		getDevice: vi.fn(),
		updateDevice: vi.fn(),
		deleteDevice: vi.fn(),
		listDevicesInScope: vi.fn()
	},
	printJobStore: { findJobs: vi.fn(), put: vi.fn(), createJob: vi.fn(), lastJobOf: vi.fn() }
}));

const mockSession = vi.mocked(readSessionUserCtx);
const mockCreate = vi.mocked(printDeviceRepository.createDevice);
const mockList = vi.mocked(printDeviceRepository.listDevicesInScope);
const mockLastJob = vi.mocked(printJobStore.lastJobOf);

const input = {
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: 'โต๊ะ 1',
	host_kind: 'standalone'
};

describe('POST /api/back-office/printers', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockCreate.mockResolvedValue({ ok: true, rev: '1-a' });
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			request: new Request('http://localhost/api/back-office/printers', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=sa' },
				body: JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('creates a printer and returns the secret once with a redacted summary', async () => {
		const response = await post(input);

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const data = await response.json();
		expect(data.secret).toMatch(/^sk_print_[0-9a-f]{64}$/);
		expect(data.device).toMatchObject({
			id: 'print_device:printer-sh001-reg1',
			device_id: 'printer-sh001-reg1',
			shelter_code: 'SH001',
			status: 'active',
			secret_prefix: data.secret.slice(0, 16),
			online: false
		});
		expect(data.device).not.toHaveProperty('secret_hash');
		expect(mockCreate).toHaveBeenCalledTimes(1);
		expect(mockCreate.mock.calls[0][0]).toMatchObject({ created_by: 'sa-user' });
		expect(JSON.stringify(mockCreate.mock.calls[0][0])).not.toContain(data.secret);
	});

	it('returns 403 and creates nothing when the caller cannot manage the target shelter', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);

		const response = await post({ ...input, shelter_code: 'SH002' });

		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('FORBIDDEN');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('answers 409 CONFLICT for an existing device_id', async () => {
		mockCreate.mockResolvedValue({ conflict: true });

		const response = await post(input);

		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'CONFLICT', message: 'Device ID already exists' }
		});
	});

	it.each([
		['a malformed device_id', { device_id: 'Bad_ID' }],
		['an empty name', { name: '  ' }],
		['an unknown host_kind', { host_kind: 'cloud' }],
		['a client-supplied secret_hash', { secret_hash: 'a'.repeat(64) }]
	])('answers 422 VALIDATION for %s and creates nothing', async (_name, override) => {
		const response = await post({ ...input, ...override });

		expect(response.status).toBe(422);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockCreate).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration and kiosk staff (O-3)', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		const anonymous = await post(input);
		expect(anonymous.status).toBe(401);
		expect((await anonymous.json()).error.code).toBe('UNAUTHENTICATED');

		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await post(input)).status).toBe(403);
		mockSession.mockResolvedValueOnce(SESSIONS.kioskA);
		expect((await post(input)).status).toBe(403);
		expect(mockCreate).not.toHaveBeenCalled();
	});
});

describe('GET /api/back-office/printers', () => {
	const device = {
		_id: 'print_device:printer-sh001-reg1',
		_rev: '3-c',
		type: 'print_device' as const,
		schema_v: 1 as const,
		device_id: 'printer-sh001-reg1',
		name: 'จุดลงทะเบียน 1',
		shelter_code: 'SH001',
		station: null,
		host_kind: 'standalone' as const,
		secret_hash: 'a'.repeat(64),
		secret_prefix: 'sk_print_01234567',
		status: 'active' as const,
		last_seen_at: new Date().toISOString(),
		queue_state: 'ready' as const,
		agent_version: '0.1.0',
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T02:59:50.000Z',
		created_by: 'sa-user'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockSession.mockResolvedValue(SESSIONS.admin);
		mockList.mockResolvedValue([device]);
		mockLastJob.mockResolvedValue(null);
	});

	async function get(query = ''): Promise<Response> {
		return GET({
			url: new URL(`http://localhost/api/back-office/printers${query}`),
			request: new Request(`http://localhost/api/back-office/printers${query}`, {
				headers: { cookie: 'AuthSession=abc' }
			})
		} as unknown as RequestEvent);
	}

	it('lets a system admin list every shelter, as redacted summaries with last_job and server_time', async () => {
		const response = await get();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockList).toHaveBeenCalledWith(null);
		const data = await response.json();
		expect(typeof data.server_time).toBe('string');
		expect(data.printers).toHaveLength(1);
		expect(data.printers[0]).toMatchObject({
			id: 'print_device:printer-sh001-reg1',
			device_id: 'printer-sh001-reg1',
			shelter_code: 'SH001',
			station: null,
			host_kind: 'standalone',
			status: 'active',
			secret_prefix: 'sk_print_01234567',
			queue_state: 'ready',
			agent_version: '0.1.0',
			online: true,
			last_job: null
		});
		expect(data.printers[0]).not.toHaveProperty('secret_hash');
		expect(data.printers[0]).not.toHaveProperty('_rev');
	});

	it('scopes a shelter manager to the shelters they manage, or to the one requested', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerAB);
		expect((await get()).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(['SH001', 'SH002']);
		expect((await get('?shelter_code=SH002')).status).toBe(200);
		expect(mockList).toHaveBeenLastCalledWith(['SH002']);
	});

	it('answers 403 when a manager asks for a shelter outside their scope', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);

		const response = await get('?shelter_code=SH002');

		expect(response.status).toBe(403);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockList).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration and kiosk staff (O-3)', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		expect((await get()).status).toBe(401);
		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await get()).status).toBe(403);
		mockSession.mockResolvedValueOnce(SESSIONS.kioskA);
		expect((await get()).status).toBe(403);
		expect(mockList).not.toHaveBeenCalled();
	});
});
