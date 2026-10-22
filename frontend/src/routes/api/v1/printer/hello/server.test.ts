import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { POST } from './+server';
import type { RequestEvent } from './$types';
import { printDeviceRepository, printJobStore } from '$lib/server/printers/printer-server';
import { hashPrintSecret, PrintDependencyError } from '$lib/server/printers/device-credentials';

vi.mock('$lib/server/printers/printer-server', () => ({
	printDeviceRepository: { getDeviceByDeviceId: vi.fn(), updateDevice: vi.fn() },
	printJobStore: { findJobs: vi.fn(), put: vi.fn() }
}));

describe('POST /api/v1/printer/hello', () => {
	const mockGetDevice = vi.mocked(printDeviceRepository.getDeviceByDeviceId);
	const mockUpdateDevice = vi.mocked(printDeviceRepository.updateDevice);
	const mockFindJobs = vi.mocked(printJobStore.findJobs);
	const mockPut = vi.mocked(printJobStore.put);
	const secret = 'sk_print_hello_secret';

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
		last_seen_at: null as string | null,
		queue_state: 'unknown' as const,
		agent_version: null as string | null,
		created_at: '2026-10-22T00:00:00.000Z',
		updated_at: '2026-10-22T00:00:00.000Z',
		created_by: 'sa-user'
	});

	const printingJob = () => ({
		_id: 'print_job:01JB0000000000000000000001',
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
		error_code: null
	});

	beforeEach(() => {
		vi.resetAllMocks();
		mockUpdateDevice.mockResolvedValue({ ok: true, rev: '2-b' });
		mockFindJobs.mockResolvedValue([]);
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
			request: new Request('http://localhost/api/v1/printer/hello', {
				method: 'POST',
				headers: {
					'x-device-id': 'printer-sh001-reg1',
					'x-device-secret': secret,
					'content-type': 'application/json',
					...options.headers
				},
				body: options.body ?? JSON.stringify({ agent_version: '0.1.0', queue_state: 'ready' })
			})
		} as unknown as RequestEvent;
	}

	it('greets an authenticated printer with its identity, server time and polling config', async () => {
		mockGetDevice.mockResolvedValue(device());

		const response = await POST(request());

		expect(response.status).toBe(200);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect(await response.json()).toEqual({
			device: { device_id: 'printer-sh001-reg1', name: 'จุดลงทะเบียน 1', shelter_code: 'SH001' },
			server_time: '2026-10-22T03:01:00.000Z',
			config: { wait_sec: 25, lease_sec: 90 }
		});
	});

	it('does not leak the secret hash or revision', async () => {
		mockGetDevice.mockResolvedValue(device());

		const text = await (await POST(request())).text();

		expect(text).not.toContain(hashPrintSecret(secret));
		expect(text).not.toContain('secret_hash');
		expect(text).not.toContain('_rev');
	});

	it('fails the jobs this printer was printing before it restarted', async () => {
		mockGetDevice.mockResolvedValue(device());
		mockFindJobs.mockResolvedValue([printingJob()]);

		await POST(request());

		expect(mockFindJobs).toHaveBeenCalledWith({
			status: 'printing',
			printerId: 'print_device:printer-sh001-reg1'
		});
		expect(mockPut).toHaveBeenCalledWith(
			expect.objectContaining({
				_id: 'print_job:01JB0000000000000000000001',
				status: 'failed',
				error_code: 'agent_restart',
				finished_at: '2026-10-22T03:01:00.000Z'
			})
		);
	});

	it('records the heartbeat with the agent version even when the device was seen a second ago', async () => {
		mockGetDevice.mockResolvedValue({
			...device(),
			last_seen_at: '2026-10-22T03:00:59.000Z',
			queue_state: 'ready',
			agent_version: '0.1.0'
		});

		await POST(request());

		expect(mockUpdateDevice).toHaveBeenCalledWith(
			expect.objectContaining({
				last_seen_at: '2026-10-22T03:01:00.000Z',
				queue_state: 'ready',
				agent_version: '0.1.0'
			})
		);
	});

	it('treats a body that is not JSON as queue_state unknown', async () => {
		mockGetDevice.mockResolvedValue({ ...device(), queue_state: 'ready' });

		const response = await POST(request({ body: 'not json' }));

		expect(response.status).toBe(200);
		expect(mockUpdateDevice).toHaveBeenCalledWith(
			expect.objectContaining({ queue_state: 'unknown' })
		);
	});

	it.each([
		['missing device id', { 'x-device-id': '' }],
		['missing secret', { 'x-device-secret': '' }],
		['wrong secret', { 'x-device-secret': 'sk_print_wrong' }]
	])('rejects %s with 401 DEVICE_AUTH_FAILED and never touches the store', async (_l, headers) => {
		mockGetDevice.mockResolvedValue(device());

		const response = await POST(request({ headers }));

		expect(response.status).toBe(401);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('DEVICE_AUTH_FAILED');
		expect(mockFindJobs).not.toHaveBeenCalled();
		expect(mockPut).not.toHaveBeenCalled();
		expect(mockUpdateDevice).not.toHaveBeenCalled();
	});

	it('answers 503 DEPENDENCY_UNAVAILABLE when the store is down', async () => {
		mockGetDevice.mockRejectedValue(new PrintDependencyError());

		const response = await POST(request());

		expect(response.status).toBe(503);
		expect(response.headers.get('cache-control')).toBe('no-store');
		expect((await response.json()).error.code).toBe('DEPENDENCY_UNAVAILABLE');
	});
});
