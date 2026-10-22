import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { resetLazySweep } from '$lib/server/printers/lazy-sweep';
import { hashPrintSecret, PrintDependencyError } from '$lib/server/printers/device-credentials';

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDeviceByDeviceId: vi.fn(), updateDevice: vi.fn() },
	printJobStore: {
		findJobs: vi.fn(),
		put: vi.fn(),
		getLabels: vi.fn(),
		pendingCursor: vi.fn(),
		waitForPending: vi.fn()
	}
}));

describe('POST /api/v1/printer/jobs/next', () => {
	const mockGetDevice = vi.mocked(printDeviceRepository.getDeviceByDeviceId);
	const mockUpdateDevice = vi.mocked(printDeviceRepository.updateDevice);
	const mockFindJobs = vi.mocked(printJobStore.findJobs);
	const mockPut = vi.mocked(printJobStore.put);
	const mockGetLabels = vi.mocked(printJobStore.getLabels);
	const secret = 'sk_print_jobs_next_secret';

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

	const pendingJob = (ulid: string, createdAt: string) => ({
		_id: `print_job:${ulid}`,
		_rev: '1-a',
		type: 'print_job' as const,
		schema_v: 1 as const,
		shelter_code: 'SH001',
		printer_id: 'print_device:printer-sh001-reg1',
		status: 'pending' as const,
		label_count: 2,
		source: 'walk_in' as const,
		created_at: createdAt,
		created_by: 'staff-a',
		expires_at: '2026-10-22T03:10:00.000Z',
		claimed_at: null,
		lease_until: null,
		finished_at: null,
		printed: 0,
		error_code: null
	});

	beforeEach(() => {
		vi.resetAllMocks();
		resetLazySweep();
		mockUpdateDevice.mockResolvedValue({ ok: true, rev: '2-b' });
		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(new Date('2026-10-22T03:01:00.000Z'));
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	function request(
		options: { headers?: Record<string, string>; body?: string; signal?: AbortSignal } = {}
	): RequestEvent {
		return {
			request: new Request('http://localhost/api/v1/printer/jobs/next', {
				method: 'POST',
				headers: {
					'x-device-id': 'printer-sh001-reg1',
					'x-device-secret': secret,
					'content-type': 'application/json',
					...options.headers
				},
				body: options.body ?? JSON.stringify({ queue_state: 'ready' }),
				signal: options.signal
			})
		} as unknown as RequestEvent;
	}

	function storeUntouched() {
		expect(mockFindJobs).not.toHaveBeenCalled();
		expect(mockPut).not.toHaveBeenCalled();
		expect(mockGetLabels).not.toHaveBeenCalled();
		expect(vi.mocked(printJobStore.pendingCursor)).not.toHaveBeenCalled();
		expect(vi.mocked(printJobStore.waitForPending)).not.toHaveBeenCalled();
		expect(mockUpdateDevice).not.toHaveBeenCalled();
	}

	it('claims the oldest pending job for an authenticated printer and returns it with its labels', async () => {
		mockGetDevice.mockResolvedValue(device());
		mockFindJobs.mockResolvedValue([
			pendingJob('01JB0000000000000000000002', '2026-10-22T03:00:05.000Z'),
			pendingJob('01JB0000000000000000000001', '2026-10-22T03:00:01.000Z')
		]);
		mockPut.mockResolvedValue({ ok: true, rev: '2-b' });
		mockGetLabels.mockResolvedValue(['AAA=', 'BBB=']);

		const response = await POST(request());
		const data = await response.json();

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(data).toEqual({
			job: {
				id: '01JB0000000000000000000001',
				label_count: 2,
				lease_until: '2026-10-22T03:02:30.000Z'
			},
			labels: ['AAA=', 'BBB=']
		});
		expect(mockFindJobs).toHaveBeenCalledWith({
			status: 'pending',
			printerId: 'print_device:printer-sh001-reg1'
		});
		expect(mockPut).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: 'print_job:01JB0000000000000000000001',
				status: 'printing',
				claimed_at: '2026-10-22T03:01:00.000Z'
			})
		);
	});

	describe('authentication', () => {
		it.each([
			['missing device id', { 'x-device-id': '' }, device()],
			['missing secret', { 'x-device-secret': '' }, device()],
			['wrong secret', { 'x-device-secret': 'sk_print_wrong' }, device()],
			['inactive device', {}, { ...device(), status: 'inactive' as const }]
		])(
			'rejects %s with 401 DEVICE_AUTH_FAILED and never touches the store',
			async (_l, headers, found) => {
				mockGetDevice.mockResolvedValue(found);

				const response = await POST(request({ headers }));

				expect(response.status).toBe(401);
				expect(response.headers.get('cache-control')).toBe('no-store');
				expect(await response.json()).toEqual({
					error: { code: 'DEVICE_AUTH_FAILED', message: 'Device authentication failed' }
				});
				storeUntouched();
			}
		);

		it.each([
			['PrintDependencyError', new PrintDependencyError()],
			['an unexpected error', new Error('boom')]
		])('answers 503 DEPENDENCY_UNAVAILABLE when the repository throws %s', async (_l, error) => {
			mockGetDevice.mockRejectedValue(error);

			const response = await POST(request());

			expect(response.status).toBe(503);
			expect(response.headers.get('cache-control')).toBe('no-store');
			expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
		});
	});

	describe('queue_state', () => {
		it.each([
			['disabled', JSON.stringify({ queue_state: 'disabled' }), 'disabled'],
			['missing', JSON.stringify({ queue_state: 'missing' }), 'missing'],
			['an unrecognised value', JSON.stringify({ queue_state: 'banana' }), 'unknown'],
			['a body without queue_state', JSON.stringify({}), 'unknown'],
			['a body that is not JSON', 'not json', 'unknown']
		])(
			'answers 204 at once and records the state when the agent reports %s',
			async (_l, body, recorded) => {
				mockGetDevice.mockResolvedValue(device());

				const response = await POST(request({ body }));

				expect(response.status).toBe(204);
				expect(response.headers.get('cache-control')).toBe('no-store');
				expect(vi.mocked(printJobStore.pendingCursor)).not.toHaveBeenCalled();
				expect(vi.mocked(printJobStore.waitForPending)).not.toHaveBeenCalled();
				expect(mockPut).not.toHaveBeenCalled();
				expect(mockUpdateDevice).toHaveBeenCalledWith(
					expect.objectContaining({
						_id: 'print_device:printer-sh001-reg1',
						queue_state: recorded,
						last_seen_at: '2026-10-22T03:01:00.000Z'
					})
				);
			}
		);

		it('records a ready heartbeat with the server time even when the poll is hung up at once', async () => {
			mockGetDevice.mockResolvedValue({ ...device(), queue_state: 'disabled' });

			const response = await POST(request({ signal: AbortSignal.abort() }));

			expect(response.status).toBe(204);
			expect(mockUpdateDevice).toHaveBeenCalledWith(
				expect.objectContaining({ queue_state: 'ready', last_seen_at: '2026-10-22T03:01:00.000Z' })
			);
		});
	});

	describe('lazy sweep', () => {
		const leaseExpiredJob = () => ({
			...pendingJob('01JB0000000000000000000009', '2026-10-22T02:50:00.000Z'),
			status: 'printing' as const,
			claimed_at: '2026-10-22T02:58:00.000Z',
			lease_until: '2026-10-22T03:00:00.000Z'
		});

		beforeEach(() => {
			mockGetDevice.mockResolvedValue(device());
			mockPut.mockResolvedValue({ ok: true, rev: '9-z' });
			mockFindJobs.mockImplementation(async ({ status }) =>
				status === 'printing' ? [leaseExpiredJob()] : []
			);
		});

		const sweptPrintingJobs = () =>
			mockFindJobs.mock.calls.filter(([query]) => query.status === 'printing').length;

		it('fails a printing job whose lease has run out while serving a poll', async () => {
			const response = await POST(request({ signal: AbortSignal.abort() }));

			expect(response.status).toBe(204);
			expect(mockPut).toHaveBeenCalledWith(
				expect.objectContaining({
					_id: 'print_job:01JB0000000000000000000009',
					status: 'failed',
					error_code: 'lease_expired',
					finished_at: '2026-10-22T03:01:00.000Z'
				})
			);
		});

		it('sweeps at most once per 30 s', async () => {
			await POST(request({ signal: AbortSignal.abort() }));
			vi.setSystemTime(new Date('2026-10-22T03:01:29.999Z'));
			await POST(request({ signal: AbortSignal.abort() }));
			expect(sweptPrintingJobs()).toBe(1);

			vi.setSystemTime(new Date('2026-10-22T03:01:30.000Z'));
			await POST(request({ signal: AbortSignal.abort() }));
			expect(sweptPrintingJobs()).toBe(2);
		});

		it('still answers the poll when the sweep fails, and does not retry it at once', async () => {
			mockFindJobs.mockRejectedValue(new PrintDependencyError());

			const first = await POST(request({ signal: AbortSignal.abort() }));
			const second = await POST(request({ signal: AbortSignal.abort() }));

			expect([first.status, second.status]).toEqual([204, 204]);
			expect(mockFindJobs).toHaveBeenCalledTimes(1);
		});
	});
});
