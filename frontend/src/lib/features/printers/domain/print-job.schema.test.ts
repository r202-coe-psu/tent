import { describe, expect, it } from 'vitest';
import { printJobCreateInputSchema } from './print-job.schema';

// 8 PNG magic bytes (89 50 4E 47 0D 0A 1A 0A) + 00 00 00 0D
const PNG_LABEL = 'iVBORw0KGgoAAAAN';

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

const PNG_MAGIC_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** A PNG-prefixed label whose decoded size is exactly `bytes` (bytes must be a multiple of 3). */
function labelOfBytes(bytes: number): string {
	return Buffer.concat([PNG_MAGIC_BYTES, Buffer.alloc(bytes - PNG_MAGIC_BYTES.length)]).toString(
		'base64'
	);
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
