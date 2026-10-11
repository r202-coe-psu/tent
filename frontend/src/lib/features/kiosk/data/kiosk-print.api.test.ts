import { describe, expect, it, vi } from 'vitest';
import {
	KIOSK_PRINT_MAX_LABELS_PER_REQUEST,
	KIOSK_PRINT_PATH,
	KioskPrintError,
	printKioskLabels
} from './kiosk-print.api';

const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

describe('printKioskLabels', () => {
	it('posts the labels uncached to the scanner-client print path', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(json({ printed: 2 }, 200));

		await expect(printKioskLabels(['a', 'b'], fetchFn)).resolves.toEqual({
			kind: 'printed',
			printed: 2
		});
		expect(fetchFn).toHaveBeenCalledWith(
			KIOSK_PRINT_PATH,
			expect.objectContaining({
				method: 'POST',
				cache: 'no-store',
				body: JSON.stringify({ labels: ['a', 'b'] }),
				signal: expect.any(AbortSignal)
			})
		);
	});

	it('reports unavailable when no scanner client answers (404)', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
		await expect(printKioskLabels(['a'], fetchFn)).resolves.toEqual({ kind: 'unavailable' });
	});

	it('surfaces the printer error with how many labels were already sent', async () => {
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValue(json({ printed: 1, error: { message: 'กระดาษหมด' } }, 502));

		const error = await printKioskLabels(['a', 'b'], fetchFn).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(KioskPrintError);
		expect(error).toMatchObject({ message: 'กระดาษหมด', printed: 1 });
	});

	it('fails with a retryable error when the request cannot be sent', async () => {
		const fetchFn = vi.fn<typeof fetch>().mockRejectedValue(new TypeError('offline'));
		await expect(printKioskLabels(['a'], fetchFn)).rejects.toBeInstanceOf(KioskPrintError);
	});

	it('splits a large household into sequential requests and adds up what printed', async () => {
		const labels = Array.from({ length: 25 }, (_, index) => `label-${index}`);
		const sent: string[][] = [];
		const fetchFn = vi.fn<typeof fetch>(async (_input, init) => {
			const body = JSON.parse(String(init?.body)) as { labels: string[] };
			sent.push(body.labels);
			return json({ printed: body.labels.length }, 200);
		});

		await expect(printKioskLabels(labels, fetchFn)).resolves.toEqual({
			kind: 'printed',
			printed: 25
		});
		expect(sent.every((chunk) => chunk.length <= KIOSK_PRINT_MAX_LABELS_PER_REQUEST)).toBe(true);
		expect(sent.flat()).toEqual(labels);
	});

	it('stops at a failed request and counts the labels of earlier requests as printed', async () => {
		const labels = Array.from({ length: 25 }, (_, index) => `label-${index}`);
		const fetchFn = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(json({ printed: KIOSK_PRINT_MAX_LABELS_PER_REQUEST }, 200))
			.mockResolvedValueOnce(json({ printed: 2, error: { message: 'กระดาษหมด' } }, 502));

		const error = await printKioskLabels(labels, fetchFn).catch((caught: unknown) => caught);
		expect(error).toBeInstanceOf(KioskPrintError);
		expect(error).toMatchObject({
			message: 'กระดาษหมด',
			printed: KIOSK_PRINT_MAX_LABELS_PER_REQUEST + 2
		});
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it('falls back (unavailable) only when the first request finds no scanner client', async () => {
		const labels = Array.from({ length: 25 }, (_, index) => `label-${index}`);
		const fetchFn = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 404 }));
		await expect(printKioskLabels(labels, fetchFn)).resolves.toEqual({ kind: 'unavailable' });
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
