import { describe, expect, it, vi } from 'vitest';
import {
	SCANNER_CLIENT_LABELS_PER_REQUEST,
	SCANNER_CLIENT_PRINTER_PATH,
	SCANNER_CLIENT_PRINT_PATH,
	ScannerClientPrintError,
	findScannerClientPrinter,
	printOnScannerClient
} from './scanner-client-print.api';

const json = (status: number, body: unknown) =>
	new Response(JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});

describe('findScannerClientPrinter', () => {
	it('asks the scanner client for its USB printer with a same-origin POST', async () => {
		const fetchFn = vi.fn(async () => json(200, { available: true, name: 'XP-365B' }));

		await expect(findScannerClientPrinter(fetchFn)).resolves.toEqual({ name: 'XP-365B' });
		expect(fetchFn).toHaveBeenCalledWith(
			SCANNER_CLIENT_PRINTER_PATH,
			expect.objectContaining({ method: 'POST', cache: 'no-store' })
		);
	});

	it.each([
		['no scanner client (plain browser: the app has no such route)', async () => json(404, {})],
		['the PC has no such printer', async () => json(200, { available: false, name: 'XP-365B' })],
		['an unexpected body', async () => json(200, { available: 'yes' })],
		[
			'the request fails',
			async () => {
				throw new TypeError('network');
			}
		]
	])('is null when %s', async (_case, impl) => {
		await expect(findScannerClientPrinter(vi.fn(impl))).resolves.toBeNull();
	});
});

describe('printOnScannerClient', () => {
	it('posts the labels and returns how many printed', async () => {
		const fetchFn = vi.fn(async () => json(200, { printed: 2 }));

		await expect(printOnScannerClient(['A', 'B'], fetchFn)).resolves.toBe(2);
		expect(fetchFn).toHaveBeenCalledWith(
			SCANNER_CLIENT_PRINT_PATH,
			expect.objectContaining({ method: 'POST', body: JSON.stringify({ labels: ['A', 'B'] }) })
		);
	});

	it('sends a big family in requests the scanner client can print in time', async () => {
		const total = SCANNER_CLIENT_LABELS_PER_REQUEST * 2 + 1;
		const labels = Array.from({ length: total }, (_, i) => `L${i}`);
		const fetchFn = vi.fn(async (_path: RequestInfo | URL, init?: RequestInit) => {
			const sent = JSON.parse(String(init?.body)).labels as string[];
			return json(200, { printed: sent.length });
		});

		await expect(printOnScannerClient(labels, fetchFn)).resolves.toBe(total);
		const batches = fetchFn.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).labels);
		expect(batches.map((b: string[]) => b.length)).toEqual([
			SCANNER_CLIENT_LABELS_PER_REQUEST,
			SCANNER_CLIENT_LABELS_PER_REQUEST,
			1
		]);
		expect(batches.flat()).toEqual(labels);
	});

	it('stops at a failed request and counts every label already printed', async () => {
		const labels = Array.from({ length: SCANNER_CLIENT_LABELS_PER_REQUEST + 2 }, (_, i) => `L${i}`);
		const fetchFn = vi
			.fn()
			.mockResolvedValueOnce(json(200, { printed: SCANNER_CLIENT_LABELS_PER_REQUEST }))
			.mockResolvedValueOnce(
				json(502, { printed: 1, error: { code: 'PRINT_FAILED', message: 'x' } })
			);

		const error = await printOnScannerClient(labels, fetchFn).catch((e) => e);

		expect(error).toBeInstanceOf(ScannerClientPrintError);
		expect(error.code).toBe('PRINT_FAILED');
		expect(error.printed).toBe(SCANNER_CLIENT_LABELS_PER_REQUEST + 1);
	});

	it.each([
		['PRINTER_NOT_FOUND', 503],
		['PRINT_TIMEOUT', 502],
		['INVALID_LABELS', 400]
	])('reports the scanner client error code %s', async (code, status) => {
		const fetchFn = vi.fn(async () => json(status, { printed: 0, error: { code } }));

		const error = await printOnScannerClient(['A'], fetchFn).catch((e) => e);

		expect(error).toBeInstanceOf(ScannerClientPrintError);
		expect(error.code).toBe(code);
		expect(error.printed).toBe(0);
	});

	it.each([
		['the request fails', async () => Promise.reject(new TypeError('network'))],
		['the scanner client is gone (404)', async () => json(404, {})],
		['an unknown error body', async () => json(500, 'oops')]
	])('reports a connection problem when %s', async (_case, impl) => {
		const error = await printOnScannerClient(['A'], vi.fn(impl)).catch((e) => e);

		expect(error).toBeInstanceOf(ScannerClientPrintError);
		expect(error.code).toBe('connection');
	});
});
