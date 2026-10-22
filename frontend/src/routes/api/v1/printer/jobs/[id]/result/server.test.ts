import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { hashPrintSecret, PrintDependencyError } from '$lib/server/printers/device-credentials';

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDeviceByDeviceId: vi.fn(), updateDevice: vi.fn() },
	printJobStore: { get: vi.fn(), put: vi.fn() }
}));

describe('POST /api/v1/printer/jobs/[id]/result', () => {
	const mockGetDevice = vi.mocked(printDeviceRepository.getDeviceByDeviceId);
	const mockGetJob = vi.mocked(printJobStore.get);
	const mockPut = vi.mocked(printJobStore.put);
	const secret = 'sk_print_result_secret';
	const ULID = '01JB0000000000000000000001';

	const device = () => ({
		_id: 'print_device:printer-sh001-reg1',
		_rev: '1-a',
		type: 'print_device' as const,
		schema_v: 1 as const,
		device_id: 'printer-sh001-reg1',
		name: 'จุดลงทะเบียน 1',
		shelter_code: 'SH001',
		station: null,
		host_kind: 'standalone' as const,
		secret_hash: hashPrintSecret(secret),
		secret_prefix: 'sk_print_01234567',
		status: 'active' as const,
		last_seen_at: null,
		queue_state: 'ready' as const,
		agent_version: null,
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T00:00:00.000Z',
		created_by: 'sa-user'
	});

	const printingJob = (overrides: Record<string, unknown> = {}) => ({
		_id: `print_job:${ULID}`,
		_rev: '2-b',
		type: 'print_job' as const,
		schema_v: 1 as const,
		shelter_code: 'SH001',
		printer_id: 'print_device:printer-sh001-reg1',
		status: 'printing' as const,
		label_count: 2,
		source: 'walk_in' as const,
		created_at: '2026-10-22T03:00:01.000Z',
		created_by: 'staff-a',
		expires_at: '2026-10-22T03:10:00.000Z',
		claimed_at: '2026-10-22T03:00:30.000Z',
		lease_until: '2026-10-22T03:02:00.000Z',
		finished_at: null,
		printed: 0,
		error_code: null,
		...overrides
	});

	beforeEach(() => {
		vi.resetAllMocks();
		mockGetDevice.mockResolvedValue(device());
		mockGetJob.mockResolvedValue(printingJob());
		mockPut.mockResolvedValue({ ok: true, rev: '3-c' });
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-22T03:01:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function request(
		options: { headers?: Record<string, string>; body?: string } = {}
	): RequestEvent {
		return {
			params: { id: ULID },
			request: new Request(`http://localhost/api/v1/printer/jobs/${ULID}/result`, {
				method: 'POST',
				headers: {
					'x-device-id': 'printer-sh001-reg1',
					'x-device-secret': secret,
					'content-type': 'application/json',
					...options.headers
				},
				body: options.body ?? JSON.stringify({ printed: 2 })
			})
		} as unknown as RequestEvent;
	}

	it('closes the printing job as printed and answers its status', async () => {
		const response = await POST(request());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({ status: 'printed' });
		expect(mockGetJob).toHaveBeenCalledWith(`print_job:${ULID}`);
		expect(mockPut).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: `print_job:${ULID}`,
				status: 'printed',
				printed: 2,
				error_code: null,
				finished_at: '2026-10-22T03:01:00.000Z'
			})
		);
	});

	it('closes the job as failed with the reported error_code and the partial count', async () => {
		const response = await POST(
			request({ body: JSON.stringify({ printed: 1, error_code: 'lp_failed' }) })
		);

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: 'failed' });
		expect(mockPut).toHaveBeenCalledWith(
			expect.objectContaining({ status: 'failed', printed: 1, error_code: 'lp_failed' })
		);
	});

	it.each([
		['negative printed', { printed: -1 }],
		['fractional printed', { printed: 1.5 }],
		['string printed', { printed: '2' }],
		['missing printed', {}],
		['unknown error_code', { printed: 1, error_code: 'paper_jam' }],
		['agent_restart error_code (server-only)', { printed: 1, error_code: 'agent_restart' }],
		['null error_code', { printed: 1, error_code: null }]
	])('rejects %s with 422 VALIDATION and leaves the job alone', async (_l, body) => {
		const response = await POST(request({ body: JSON.stringify(body) }));

		expect(response.status).toBe(422);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('VALIDATION');
		expect(mockGetJob).not.toHaveBeenCalled();
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('rejects a body that is not JSON with 422 VALIDATION', async () => {
		const response = await POST(request({ body: 'not json' }));

		expect(response.status).toBe(422);
		expect((await response.json()).error.code).toBe('VALIDATION');
	});

	it.each(['printer_timeout', 'queue_disabled', 'lp_failed'])(
		'accepts error_code %s',
		async (errorCode) => {
			const response = await POST(
				request({ body: JSON.stringify({ printed: 0, error_code: errorCode }) })
			);

			expect(response.status).toBe(200);
		}
	);

	it.each([
		['the job does not exist', null],
		['the job belongs to another printer', printingJob({ printer_id: 'print_device:other' })],
		['the job is no longer printing', printingJob({ status: 'failed' })]
	])('answers 409 JOB_CONFLICT when %s', async (_l, found) => {
		mockGetJob.mockResolvedValue(found);

		const response = await POST(request());

		expect(response.status).toBe(409);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('JOB_CONFLICT');
		expect(mockPut).not.toHaveBeenCalled();
	});

	it('answers 409 JOB_CONFLICT when the job changed under the write', async () => {
		mockPut.mockResolvedValue({ conflict: true });

		const response = await POST(request());

		expect(response.status).toBe(409);
		expect((await response.json()).error.code).toBe('JOB_CONFLICT');
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when the store fails', async () => {
		mockPut.mockRejectedValue(new PrintDependencyError());

		const response = await POST(request());

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});

	it.each([
		['missing device id', { 'x-device-id': '' }],
		['missing secret', { 'x-device-secret': '' }],
		['wrong secret', { 'x-device-secret': 'sk_print_wrong' }]
	])('rejects %s with 401 DEVICE_AUTH_FAILED and never touches the job', async (_l, headers) => {
		const response = await POST(request({ headers }));

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(mockGetJob).not.toHaveBeenCalled();
		expect(mockPut).not.toHaveBeenCalled();
	});
});
