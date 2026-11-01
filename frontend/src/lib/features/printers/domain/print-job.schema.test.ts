import { describe, expect, it } from 'vitest';
import { labelPngBase64, labelPngBytes, toBase64 } from '$lib/testing/label-png';
import { printJobCreateInputSchema, printJobCreateResponseSchema } from './print-job.schema';

// A valid 639x479 RGBA label PNG header (only the header is inspected, see label-png.ts)
const PNG_LABEL = labelPngBase64();

describe('printJobCreateInputSchema', () => {
	it('accepts a printer, a source and PNG labels', () => {
		const result = printJobCreateInputSchema.safeParse({
			printer_id: 'print_device:printer-sh001-reg1',
			source: 'walk_in',
			labels: [PNG_LABEL, PNG_LABEL]
		});

		expect(result.success).toBe(true);
	});
});

/** A label PNG whose decoded size is exactly `bytes` (bytes must be a multiple of 3). */
function labelOfBytes(bytes: number): string {
	return labelPngBase64({ size: bytes });
}

describe('printJobCreateInputSchema rejections', () => {
	const base = { printer_id: 'print_device:printer-sh001-reg1', source: 'walk_in' as const };
	const parse = (overrides: Record<string, unknown>) =>
		printJobCreateInputSchema.safeParse({ ...base, labels: [PNG_LABEL], ...overrides }).success;

	it('accepts exactly 20 labels', () => {
		expect(parse({ labels: Array<string>(20).fill(PNG_LABEL) })).toBe(true);
	});

	it.each([
		['0 labels', []],
		['21 labels', Array<string>(21).fill(PNG_LABEL)],
		['a label that is not base64', ['not base64!!']],
		['a label without the PNG magic', [Buffer.from('GIF89a-not-a-png').toString('base64')]],
		['a 640x480 PNG', [toBase64(labelPngBytes({ width: 640, height: 480 }))]],
		['a palette PNG', [toBase64(labelPngBytes({ colorType: 3 }))]],
		['a label of 64 KB + 3 bytes', [labelOfBytes(64 * 1024 + 3)]],
		// 17 x 63 KB = 1071 KB > 1 MB, each label alone is fine
		['labels totalling over 1 MB', Array<string>(17).fill(labelOfBytes(63 * 1024))]
	])('rejects %s', (_name, labels) => {
		expect(parse({ labels })).toBe(false);
	});

	it('accepts a label of exactly 64 KB', () => {
		expect(parse({ labels: [labelOfBytes(64 * 1024)] })).toBe(true);
	});

	it('rejects an unknown source', () => {
		expect(parse({ source: 'fax' })).toBe(false);
	});

	it('rejects an empty printer_id', () => {
		expect(parse({ printer_id: '' })).toBe(false);
	});
});

describe('printJobCreateResponseSchema', () => {
	it('carries the shelter of the job so the poller can address its DB', () => {
		const parsed = printJobCreateResponseSchema.parse({
			job_id: '01JB0000000000000000000009',
			shelter_code: 'SH001',
			expires_at: '2026-10-22T03:02:00.000Z'
		});

		expect(parsed.shelter_code).toBe('SH001');
	});

	it('rejects a response without shelter_code', () => {
		expect(
			printJobCreateResponseSchema.safeParse({
				job_id: '01JB0000000000000000000009',
				expires_at: '2026-10-22T03:02:00.000Z'
			}).success
		).toBe(false);
	});
});
