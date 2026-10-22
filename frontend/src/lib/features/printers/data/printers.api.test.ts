import type { PrintJobCreateInput } from '../domain/print-job.schema';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	createPrintJob,
	getPrintJobStatus,
	listShelterPrinters,
	PrintApiError
} from './printers.api';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function respond(status: number, body: unknown): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const printer = {
	id: 'print_device:printer-sh001-reg1',
	name: 'โต๊ะลงทะเบียน 1',
	station: 'ลงทะเบียน',
	online: true,
	queue_state: 'ready',
	last_seen_at: '2026-10-22T03:00:00.000Z'
};

afterEach(() => {
	fetchMock.mockReset();
});

describe('listShelterPrinters', () => {
	it('gets the printers of an encoded shelter code and returns them with the server time', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(200, { printers: [printer], server_time: '2026-10-22T03:00:05.000Z' })
		);

		const result = await listShelterPrinters('SH 001');

		expect(result).toEqual({ printers: [printer], server_time: '2026-10-22T03:00:05.000Z' });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url).toBe('/api/staff/v1/printers?shelter_code=SH%20001');
		expect(init?.method ?? 'GET').toBe('GET');
	});
});

describe('error envelope', () => {
	it('throws a PrintApiError carrying the contract code, message and HTTP status', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(403, { error: { code: 'FORBIDDEN', message: 'ไม่มีสิทธิ์ในศูนย์นี้' } })
		);

		const error = await listShelterPrinters('SH002').catch((e: unknown) => e);

		expect(error).toBeInstanceOf(PrintApiError);
		expect(error).toMatchObject({
			status: 403,
			code: 'FORBIDDEN',
			message: 'ไม่มีสิทธิ์ในศูนย์นี้'
		});
	});

	it('still throws a PrintApiError (code null) when the body is not an envelope', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));

		const error = await listShelterPrinters('SH001').catch((e: unknown) => e);

		expect(error).toMatchObject({ status: 502, code: null });
	});
});

describe('createPrintJob', () => {
	const input: PrintJobCreateInput = {
		printer_id: printer.id,
		source: 'walk_in',
		labels: ['iVBORw0KGgoAAAAN']
	};

	it('posts the job as JSON and returns the job id and expiry', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(201, { job_id: 'print_job:01J', expires_at: '2026-10-22T03:02:00.000Z' })
		);

		const result = await createPrintJob(input);

		expect(result).toEqual({ job_id: 'print_job:01J', expires_at: '2026-10-22T03:02:00.000Z' });
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
		expect(url).toBe('/api/staff/v1/print-jobs');
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual(input);
	});

	it('exposes PRINTER_OFFLINE so the UI can say which printer is down', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(409, { error: { code: 'PRINTER_OFFLINE', message: 'offline' } })
		);

		await expect(createPrintJob(input)).rejects.toMatchObject({
			status: 409,
			code: 'PRINTER_OFFLINE'
		});
	});
});

describe('getPrintJobStatus', () => {
	it('gets the status of an encoded job id', async () => {
		const body = { status: 'printing', printed: 1, label_count: 4, error_code: null };
		fetchMock.mockResolvedValueOnce(respond(200, body));

		expect(await getPrintJobStatus('print_job:01J')).toEqual(body);
		const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit | undefined];
		expect(url).toBe('/api/staff/v1/print-jobs/print_job%3A01J');
		expect(init?.method ?? 'GET').toBe('GET');
	});

	it('rejects a status the contract does not define', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(200, { status: 'paused', printed: 0, label_count: 4, error_code: null })
		);

		await expect(getPrintJobStatus('print_job:01J')).rejects.toThrow();
	});
});
