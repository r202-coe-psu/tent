import { error } from '@sveltejs/kit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { requireShelterScopeOrSA } from '$lib/server/couch-admin';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { PrintDependencyError, type PrintDeviceDoc } from '$lib/server/printers/device-credentials';

vi.mock('$lib/server/couch-admin', async () => {
	const actual =
		await vi.importActual<typeof import('$lib/server/couch-admin')>('$lib/server/couch-admin');
	return { ...actual, requireShelterScopeOrSA: vi.fn() };
});

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDevice: vi.fn() },
	printJobStore: { createJob: vi.fn() }
}));

// 8 PNG magic bytes + 00 00 00 0D
const LABEL = 'iVBORw0KGgoAAAAN';

describe('POST /api/staff/v1/print-jobs', () => {
	const mockAuth = vi.mocked(requireShelterScopeOrSA);
	const mockGetDevice = vi.mocked(printDeviceRepository.getDevice);
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
		last_seen_at: '2026-10-22T02:59:50.000Z',
		queue_state: 'ready',
		agent_version: '0.1.0',
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T02:59:50.000Z',
		created_by: 'sa-user'
	};

	beforeEach(() => {
		vi.clearAllMocks();
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-10-22T03:00:00.000Z'));
		mockAuth.mockResolvedValue({
			name: 'staff-a',
			roles: ['shelter:SH001'],
			isSA: false,
			shelterCode: 'SH001'
		});
		mockGetDevice.mockResolvedValue(device);
		mockCreateJob.mockResolvedValue(undefined);
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	async function post(body: unknown): Promise<Response> {
		return POST({
			request: new Request('http://localhost/api/staff/v1/print-jobs', {
				method: 'POST',
				headers: { 'content-type': 'application/json', cookie: 'AuthSession=staff-a' },
				body: JSON.stringify(body)
			})
		} as unknown as RequestEvent);
	}

	it('queues a pending job with its labels for an online printer of the staff shelter', async () => {
		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL, LABEL]
		});

		expect(response.status).toBe(201);
		expect(response.headers.get('cache-control')).toBe('no-store');
		const body = (await response.json()) as { job_id: string; expires_at: string };
		expect(body.job_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(body.expires_at).toBe('2026-10-22T03:02:00.000Z');

		expect(mockCreateJob).toHaveBeenCalledTimes(1);
		expect(mockCreateJob.mock.calls[0][0]).toEqual({
			_id: `print_job:${body.job_id}`,
			type: 'print_job',
			schema_v: 1,
			shelter_code: 'SH001',
			printer_id: 'print_device:printer-sh001-reg1',
			status: 'pending',
			label_count: 2,
			source: 'walk_in',
			created_at: '2026-10-22T03:00:00.000Z',
			created_by: 'staff-a',
			expires_at: '2026-10-22T03:02:00.000Z',
			claimed_at: null,
			lease_until: null,
			finished_at: null,
			printed: 0,
			error_code: null,
			_attachments: {
				'label-000.png': { content_type: 'image/png', data: LABEL },
				'label-001.png': { content_type: 'image/png', data: LABEL }
			}
		});
	});

	it('rejects an offline printer with 409 PRINTER_OFFLINE and stores nothing', async () => {
		mockGetDevice.mockResolvedValue({ ...device, last_seen_at: '2026-10-22T02:58:00.000Z' });

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'PRINTER_OFFLINE', message: 'Printer is offline' }
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 404 PRINTER_NOT_FOUND for an unknown printer', async () => {
		mockGetDevice.mockResolvedValue(null);

		const response = await post({
			printer_id: 'print_device:nope',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(404);
		expect(await response.json()).toEqual({
			error: { code: 'PRINTER_NOT_FOUND', message: 'Printer not found' }
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 404 PRINTER_NOT_FOUND for an inactive printer', async () => {
		mockGetDevice.mockResolvedValue({ ...device, status: 'inactive' });

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(404);
		expect((await response.json()).error.code).toBe('PRINTER_NOT_FOUND');
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it.each([
		['zero labels', { labels: [] }],
		['a non-PNG label', { labels: ['aGVsbG8gd29ybGQh'] }]
	])('answers 422 INVALID_LABELS for %s and stores nothing', async (_name, override) => {
		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			...override
		});

		expect(response.status).toBe(422);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('INVALID_LABELS');
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when the print store is down', async () => {
		mockCreateJob.mockRejectedValue(new PrintDependencyError());

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'DEPENDENCY_UNAVAILABLE', message: 'Print service unavailable' }
		});
	});

	it('answers 401 UNAUTHENTICATED for an anonymous caller', async () => {
		mockAuth.mockImplementation(async () => error(401, 'Authentication required'));

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			error: { code: 'UNAUTHENTICATED', message: 'Authentication required' }
		});
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('answers 403 FORBIDDEN when the caller is outside the printer shelter scope', async () => {
		mockAuth.mockImplementation(async (_cookie, code) =>
			code === undefined
				? { name: 'staff-b', roles: ['shelter:SH002'], isSA: false, shelterCode: 'SH002' }
				: error(403, `Caller is not in shelter "${code}" scope`)
		);

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('accepts 20 labels of ~50 KB each (a ~1 MB job)', async () => {
		const png = Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			Buffer.alloc(51198 - 8)
		]);
		const label = png.toString('base64');

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: Array.from({ length: 20 }, () => label)
		});

		expect(response.status).toBe(201);
		expect(mockCreateJob.mock.calls[0][0].label_count).toBe(20);
	});
});
