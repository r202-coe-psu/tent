import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createPrinterDevice,
	deletePrinterDevice,
	listPrinterDevices,
	rotatePrinterSecret,
	testPrintPrinter,
	updatePrinterDevice
} from './printer-admin.api';
import { PrintApiError } from './printers.api';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function respond(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const summary = {
	id: 'print_device:printer-sh001-reg1',
	device_id: 'printer-sh001-reg1',
	name: 'โต๊ะลงทะเบียน 1',
	shelter_code: 'SH001',
	station: 'ลงทะเบียน',
	host_kind: 'standalone',
	status: 'active',
	secret_prefix: 'sk_print_ab12',
	last_seen_at: '2026-10-22T03:00:00.000Z',
	queue_state: 'ready',
	agent_version: '0.1.0',
	online: true
};

const call = () => fetchMock.mock.calls[0] as [string, RequestInit];

afterEach(() => {
	fetchMock.mockReset();
});

describe('printer admin api', () => {
	it('lists printers of a shelter with their last job', async () => {
		const lastJob = {
			status: 'failed',
			finished_at: '2026-10-22T03:01:00.000Z',
			error_code: 'printer_timeout',
			created_at: '2026-10-22T03:00:00.000Z'
		};
		fetchMock.mockResolvedValueOnce(
			respond(200, {
				printers: [{ ...summary, last_job: lastJob }],
				server_time: '2026-10-22T03:02:00.000Z'
			})
		);

		const result = await listPrinterDevices('SH 001');

		expect(call()[0]).toBe('/api/back-office/printers?shelter_code=SH%20001');
		expect(result.printers[0].last_job?.error_code).toBe('printer_timeout');
		expect(result.printers[0].secret_prefix).toBe('sk_print_ab12');
	});

	it('creates a printer and returns the one-time secret', async () => {
		fetchMock.mockResolvedValueOnce(respond(201, { device: summary, secret: 'sk_print_abcdef' }));
		const input = {
			device_id: 'printer-sh001-reg1',
			name: 'โต๊ะลงทะเบียน 1',
			shelter_code: 'SH001',
			station: 'ลงทะเบียน',
			host_kind: 'standalone'
		} as const;

		const created = await createPrinterDevice(input);

		const [url, init] = call();
		expect(url).toBe('/api/back-office/printers');
		expect(init.method).toBe('POST');
		expect(JSON.parse(init.body as string)).toEqual(input);
		expect(created.secret).toBe('sk_print_abcdef');
		expect(created.device.device_id).toBe('printer-sh001-reg1');
	});

	it('patches by device id and rotates, test-prints and deletes on the encoded path', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ...summary, status: 'inactive' }));
		expect((await updatePrinterDevice('printer-sh001-reg1', { status: 'inactive' })).status).toBe(
			'inactive'
		);
		let [url, init] = call();
		expect(url).toBe('/api/back-office/printers/printer-sh001-reg1');
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({ status: 'inactive' });

		fetchMock.mockReset();
		fetchMock.mockResolvedValueOnce(respond(200, { device: summary, secret: 'sk_print_new' }));
		expect((await rotatePrinterSecret('printer-sh001-reg1')).secret).toBe('sk_print_new');
		[url, init] = call();
		expect(url).toBe('/api/back-office/printers/printer-sh001-reg1/rotate-secret');
		expect(init.method).toBe('POST');

		fetchMock.mockReset();
		fetchMock.mockResolvedValueOnce(
			respond(201, { job_id: 'job1', expires_at: '2026-10-22T03:05:00.000Z' })
		);
		expect((await testPrintPrinter('printer-sh001-reg1')).job_id).toBe('job1');
		[url, init] = call();
		expect(url).toBe('/api/back-office/printers/printer-sh001-reg1/test-print');
		expect(init.method).toBe('POST');

		fetchMock.mockReset();
		fetchMock.mockResolvedValueOnce(respond(204));
		await expect(deletePrinterDevice('printer-sh001-reg1')).resolves.toBeUndefined();
		[url, init] = call();
		expect(url).toBe('/api/back-office/printers/printer-sh001-reg1');
		expect(init.method).toBe('DELETE');
	});

	it('maps an error body to PrintApiError with status and code', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(409, { error: { code: 'PRINTER_OFFLINE', message: 'offline' } })
		);

		const failure = await testPrintPrinter('printer-sh001-reg1').catch((e: unknown) => e);

		expect(failure).toBeInstanceOf(PrintApiError);
		expect(failure).toMatchObject({ status: 409, code: 'PRINTER_OFFLINE', message: 'offline' });

		fetchMock.mockResolvedValueOnce(
			respond(404, { error: { code: 'NOT_FOUND', message: 'gone' } })
		);
		await expect(deletePrinterDevice('x')).rejects.toMatchObject({
			status: 404,
			code: 'NOT_FOUND'
		});
	});
});
