import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { readSessionUserCtx } from '$lib/server/session-auth';
import { CouchUserError } from '$lib/server/couch-as-user';
import { printDeviceRepository } from '$lib/server/printers/print-device.repo';
import { userJobStore } from '$lib/server/printers/print-job.user-store';
import { labelPngBase64 } from '$lib/testing/label-png';
import { PrintDependencyError, type PrintDeviceDoc } from '$lib/server/printers/device-credentials';
import { PrintJobConflictError } from '$lib/server/printers/print-jobs.server';

vi.mock('$lib/server/session-auth', async () => {
	const actual = await vi.importActual<typeof import('$lib/server/session-auth')>(
		'$lib/server/session-auth'
	);
	return { ...actual, readSessionUserCtx: vi.fn() };
});

vi.mock('$lib/server/printers/print-device.repo', () => ({
	printDeviceRepository: { getDevice: vi.fn() }
}));

vi.mock('$lib/server/printers/print-job.user-store', () => ({ userJobStore: vi.fn() }));

// A valid 639x479 label PNG header
const LABEL = labelPngBase64();

describe('POST /api/staff/v1/print-jobs', () => {
	const mockSession = vi.mocked(readSessionUserCtx);
	const mockGetDevice = vi.mocked(printDeviceRepository.getDevice);
	const mockUserJobStore = vi.mocked(userJobStore);
	const mockCreateJob = vi.fn();

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
		mockSession.mockResolvedValue({
			name: 'staff-a',
			roles: ['shelter:SH001', 'SH001:registration_staff']
		});
		mockGetDevice.mockResolvedValue(device);
		mockCreateJob.mockReset();
		mockCreateJob.mockResolvedValue(undefined);
		mockUserJobStore.mockReturnValue({ createJob: mockCreateJob, get: vi.fn() });
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
		const body = (await response.json()) as {
			job_id: string;
			shelter_code: string;
			expires_at: string;
		};
		expect(body.job_id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
		expect(body.shelter_code).toBe('SH001');
		expect(body.expires_at).toBe('2026-10-22T03:02:00.000Z');
		expect(mockUserJobStore).toHaveBeenCalledWith('AuthSession=staff-a', 'SH001');

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

	describe('with a client-minted job_id', () => {
		const JOB_ID = '01JC0000000000000000000001';
		const request = {
			job_id: JOB_ID,
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		};
		const written = (over: Record<string, unknown> = {}) => ({
			_id: `print_job:${JOB_ID}`,
			shelter_code: 'SH001',
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			label_count: 1,
			created_by: 'staff-a',
			expires_at: '2026-10-22T03:01:50.000Z',
			...over
		});

		it('writes the job under that id', async () => {
			const response = await post(request);

			expect(response.status).toBe(201);
			expect((await response.json()).job_id).toBe(JOB_ID);
			expect(mockCreateJob.mock.calls[0][0]._id).toBe(`print_job:${JOB_ID}`);
		});

		it('answers a retry of an already written job with that job, not a duplicate', async () => {
			const get = vi.fn().mockResolvedValue(written());
			mockCreateJob.mockRejectedValue(new PrintJobConflictError());
			mockUserJobStore.mockReturnValue({ createJob: mockCreateJob, get });

			const response = await post(request);

			expect(response.status).toBe(201);
			expect(await response.json()).toEqual({
				job_id: JOB_ID,
				shelter_code: 'SH001',
				expires_at: '2026-10-22T03:01:50.000Z'
			});
			expect(get).toHaveBeenCalledWith(`print_job:${JOB_ID}`);
		});

		it("answers 409 JOB_ID_CONFLICT when the id holds another staff member's job", async () => {
			mockCreateJob.mockRejectedValue(new PrintJobConflictError());
			mockUserJobStore.mockReturnValue({
				createJob: mockCreateJob,
				get: vi.fn().mockResolvedValue(written({ created_by: 'staff-b' }))
			});

			const response = await post(request);

			expect(response.status).toBe(409);
			expect((await response.json()).error.code).toBe('JOB_ID_CONFLICT');
		});

		it.each([['not-a-ulid'], ['print_job:01JC0000000000000000000001']])(
			'answers 422 INVALID_LABELS for the malformed job_id %s',
			async (jobId) => {
				const response = await post({ ...request, job_id: jobId });

				expect(response.status).toBe(422);
				expect(mockCreateJob).not.toHaveBeenCalled();
			}
		);
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
		['a non-PNG label', { labels: ['aGVsbG8gd29ybGQh'] }],
		['a PNG that is not label-sized', { labels: [labelPngBase64({ width: 640, height: 480 })] }]
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
		mockSession.mockResolvedValue({ name: null, roles: [] });

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

	it.each([
		['a role that may not print', ['shelter:SH001', 'SH001:kitchen_staff']],
		["another shelter's role", ['shelter:SH002', 'SH002:registration_staff']]
	])('answers 403 FORBIDDEN for %s and stores nothing', async (_name, roles) => {
		mockSession.mockResolvedValue({ name: 'staff-b', roles });

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(403);
		expect((await response.json()).error.code).toBe('FORBIDDEN');
		expect(mockCreateJob).not.toHaveBeenCalled();
	});

	it('lets a system admin print on any shelter', async () => {
		mockSession.mockResolvedValue({ name: 'sa-user', roles: ['system_admin'] });

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(201);
		expect(mockCreateJob.mock.calls[0][0].created_by).toBe('sa-user');
	});

	it('answers 403 FORBIDDEN, leaking no CouchDB reason, when the validation hook refuses', async () => {
		mockCreateJob.mockRejectedValue(
			new CouchUserError('FORBIDDEN', 'Not permitted', 'forbidden: vdu said no')
		);

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(403);
		expect(await response.json()).toEqual({
			error: { code: 'FORBIDDEN', message: 'Not permitted' }
		});
	});

	it('answers 401 UNAUTHENTICATED when CouchDB rejects the session', async () => {
		mockCreateJob.mockRejectedValue(
			new CouchUserError('UNAUTHENTICATED', 'Authentication required')
		);

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [LABEL]
		});

		expect(response.status).toBe(401);
		expect((await response.json()).error.code).toBe('UNAUTHENTICATED');
	});

	it('accepts 20 labels of ~50 KB each (a ~1 MB job)', async () => {
		const label = labelPngBase64({ size: 51198 });

		const response = await post({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: Array.from({ length: 20 }, () => label)
		});

		expect(response.status).toBe(201);
		expect(mockCreateJob.mock.calls[0][0].label_count).toBe(20);
	});
});
