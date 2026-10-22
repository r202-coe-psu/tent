import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DELETE, PATCH } from './+server';
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
const mockGet = vi.mocked(printDeviceRepository.getDevice);
const mockUpdate = vi.mocked(printDeviceRepository.updateDevice);
const mockDelete = vi.mocked(printDeviceRepository.deleteDevice);
const mockFindJobs = vi.mocked(printJobStore.findJobs);
const mockPutJob = vi.mocked(printJobStore.put);

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
	last_seen_at: '2026-10-22T02:59:50.000Z',
	queue_state: 'ready',
	agent_version: '0.1.0',
	created_at: '2026-10-22T00:00:00.000Z',
	updated_at: '2026-10-22T02:59:50.000Z',
	created_by: 'sa-user'
};

beforeEach(() => {
	vi.clearAllMocks();
	mockSession.mockResolvedValue(SESSIONS.admin);
	mockGet.mockResolvedValue(device);
	mockUpdate.mockResolvedValue({ ok: true, rev: '4-d' });
	mockDelete.mockResolvedValue({ ok: true });
	mockFindJobs.mockResolvedValue([]);
	mockPutJob.mockResolvedValue({ ok: true, rev: '2-b' });
});

function event(id: string, method: string, body?: unknown): RequestEvent {
	return {
		params: { id },
		request: new Request(`http://localhost/api/back-office/printers/${id}`, {
			method,
			headers: { 'content-type': 'application/json', cookie: 'AuthSession=sa' },
			body: body === undefined ? undefined : JSON.stringify(body)
		})
	} as unknown as RequestEvent;
}

describe('PATCH /api/back-office/printers/[id]', () => {
	const patch = (id: string, body: unknown) => PATCH(event(id, 'PATCH', body));

	it('renames and deactivates a printer, answering the redacted summary', async () => {
		const response = await patch('printer-sh001-reg1', { name: 'ใหม่', status: 'inactive' });

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const data = await response.json();
		expect(data).toMatchObject({
			id: 'print_device:printer-sh001-reg1',
			name: 'ใหม่',
			status: 'inactive',
			shelter_code: 'SH001'
		});
		expect(data).not.toHaveProperty('secret_hash');
		expect(mockUpdate).toHaveBeenCalledTimes(1);
		expect(mockUpdate.mock.calls[0][0]).toMatchObject({ name: 'ใหม่', status: 'inactive' });
		expect(mockUpdate.mock.calls[0][0].updated_at).not.toBe(device.updated_at);
	});

	it('answers 404 NOT_FOUND for an unknown printer or a malformed id, writing nothing', async () => {
		mockGet.mockResolvedValue(null);
		const unknown = await patch('printer-nope', { name: 'x' });
		expect(unknown.status).toBe(404);
		expect(await unknown.json()).toEqual({
			error: { code: 'NOT_FOUND', message: 'Printer not found' }
		});

		expect((await patch('Bad_ID', { name: 'x' })).status).toBe(404);
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('hides a printer of another shelter from a manager as 404 and writes nothing', async () => {
		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue({ ...device, shelter_code: 'SH002' });

		const response = await patch('printer-sh001-reg1', { name: 'x' });

		expect(response.status).toBe(404);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it.each([
		['an empty body', {}],
		['a bad status', { status: 'broken' }],
		['a shelter change', { shelter_code: 'SH002' }],
		['an empty name', { name: ' ' }]
	])('answers 422 VALIDATION for %s', async (_name, body) => {
		const response = await patch('printer-sh001-reg1', body);

		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockUpdate).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration and kiosk staff (O-3)', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		expect((await patch('printer-sh001-reg1', { name: 'x' })).status).toBe(401);
		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await patch('printer-sh001-reg1', { name: 'x' })).status).toBe(403);
		mockSession.mockResolvedValueOnce(SESSIONS.kioskA);
		expect((await patch('printer-sh001-reg1', { name: 'x' })).status).toBe(403);
		expect(mockUpdate).not.toHaveBeenCalled();
	});
});

describe('DELETE /api/back-office/printers/[id]', () => {
	const del = (id: string) => DELETE(event(id, 'DELETE'));

	it('answers 204, failing the pending job of the printer before deleting it', async () => {
		mockFindJobs.mockImplementation(async ({ status }) =>
			status === 'pending'
				? [
						{
							_id: 'print_job:P',
							type: 'print_job',
							schema_v: 1,
							shelter_code: 'SH001',
							printer_id: 'print_device:printer-sh001-reg1',
							status: 'pending',
							label_count: 1,
							source: 'walk_in',
							created_at: '2026-10-22T02:59:00.000Z',
							created_by: 'staff-a',
							expires_at: '2026-10-22T03:01:00.000Z',
							claimed_at: null,
							lease_until: null,
							finished_at: null,
							printed: 0,
							error_code: null,
							_attachments: { 'label-000.png': {} }
						}
					]
				: []
		);

		const response = await del('printer-sh001-reg1');

		expect(response.status).toBe(204);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.text()).toBe('');
		expect(mockPutJob.mock.calls[0][0]).toMatchObject({
			_id: 'print_job:P',
			status: 'failed',
			error_code: 'printer_deleted'
		});
		expect(mockPutJob.mock.calls[0][0]).not.toHaveProperty('_attachments');
		expect(mockDelete).toHaveBeenCalledWith(device);
	});

	it('answers 404 for an unknown printer and for one outside the manager scope, deleting nothing', async () => {
		mockGet.mockResolvedValue(null);
		expect((await del('printer-nope')).status).toBe(404);

		mockSession.mockResolvedValue(SESSIONS.managerA);
		mockGet.mockResolvedValue({ ...device, shelter_code: 'SH002' });
		expect((await del('printer-sh001-reg1')).status).toBe(404);
		expect(mockDelete).not.toHaveBeenCalled();
		expect(mockPutJob).not.toHaveBeenCalled();
	});

	it('answers 401 for anonymous and 403 for registration and kiosk staff (O-3)', async () => {
		mockSession.mockResolvedValueOnce(SESSIONS.anonymous);
		expect((await del('printer-sh001-reg1')).status).toBe(401);
		mockSession.mockResolvedValueOnce(SESSIONS.registrationA);
		expect((await del('printer-sh001-reg1')).status).toBe(403);
		mockSession.mockResolvedValueOnce(SESSIONS.kioskA);
		expect((await del('printer-sh001-reg1')).status).toBe(403);
		expect(mockDelete).not.toHaveBeenCalled();
	});
});
