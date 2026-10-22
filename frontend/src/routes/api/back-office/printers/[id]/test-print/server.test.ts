import { beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/couch-admin';
import type { PrintDeviceDoc } from '$lib/server/printers/device-credentials';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { SESSIONS } from '$lib/server/scanners/test-sessions';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDevice: vi.fn() },
	printJobStore: { createJob: vi.fn() }
}));

const mockSession = vi.mocked(readSessionUserCtx);
const mockGet = vi.mocked(printDeviceRepository.getDevice);
const mockCreateJob = vi.mocked(printJobStore.createJob);

const device: PrintDeviceDoc = {
	_id: 'print_device:printer-sh001-reg1',
	_rev: '3-c',
	type: 'print_device',
	schema_v: 1,
	device_id: 'printer-sh001-reg1',
	name: 'จุดลงทะเบียน 1',
	shelter_code: 'SH001',
	station: null,
	host_kind: 'standalone',
	secret_hash: 'a'.repeat(64),
	secret_prefix: 'sk_print_01234567',
	status: 'active',
	last_seen_at: null,
	queue_state: 'ready',
	agent_version: '0.1.0',
	created_at: '2026-10-22T00:00:00.000Z',
	updated_at: '2026-10-22T02:59:50.000Z',
	created_by: 'sa-user'
};

beforeEach(() => {
	vi.clearAllMocks();
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-10-22T03:00:00.000Z'));
	mockSession.mockResolvedValue(SESSIONS.managerA);
	mockGet.mockResolvedValue({ ...device, last_seen_at: '2026-10-22T02:59:50.000Z' });
	mockCreateJob.mockResolvedValue(undefined);
});

async function post(id: string): Promise<Response> {
	return POST({
		params: { id },
		request: new Request(`http://localhost/api/back-office/printers/${id}/test-print`, {
			method: 'POST',
			headers: { cookie: 'AuthSession=sm-a' }
		})
	} as unknown as RequestEvent);
}

describe('POST /api/back-office/printers/[id]/test-print', () => {
	it('queues a one-label test job for an online printer of the managed shelter', async () => {
		const response = await post('printer-sh001-reg1');

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const data = await response.json();
		expect(data.job_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(data.expires_at).toBe('2026-10-22T03:02:00.000Z');
		expect(mockCreateJob).toHaveBeenCalledTimes(1);
		expect(mockCreateJob.mock.calls[0][0]).toMatchObject({
			_id: `print_job:${data.job_id}`,
			source: 'test',
			label_count: 1,
			printer_id: 'print_device:printer-sh001-reg1',
			created_by: 'sm-a',
			status: 'pending'
		});
	});

	it('answers 409 PRINTER_OFFLINE and queues nothing when the printer has not polled recently', async () => {
		mockGet.mockResolvedValue({ ...device, last_seen_at: '2026-10-22T02:55:00.000Z' });

		const response = await post('printer-sh001-reg1');

		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'PRINTER_OFFLINE', message: 'Printer is offline' }
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 404 for an unknown printer, an inactive one, and one outside the manager scope', async () => {
		mockGet.mockResolvedValue(null);
		expect((await post('printer-nope')).status).toBe(404);

		mockGet.mockResolvedValue({
			...device,
			status: 'inactive',
			last_seen_at: '2026-10-22T02:59:50.000Z'
		});
		expect((await post('printer-sh001-reg1')).status).toBe(404);

		mockGet.mockResolvedValue({ ...device, shelter_code: 'SH002' });
		expect((await post('printer-sh001-reg1')).status).toBe(404);
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration and kiosk staff (O-3)', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		expect((await post('printer-sh001-reg1')).status).toBe(401);
		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await post('printer-sh001-reg1')).status).toBe(403);
		mockSession.mockResolvedValueOnce(SESSIONS.kioskA);
		expect((await post('printer-sh001-reg1')).status).toBe(403);
		expect(mockCreateJob).not.toHaveBeenCalled();
	});
});
