import { describe, expect, it } from 'vitest';
import { labelPngBytes, toBase64 } from '$lib/testing/label-png';
import { isPrintableLabel, isPrintableLabelBytes, readPngHeader } from './label-png';

// Fixtures are a PNG signature + IHDR chunk padded with zeros. The CRC stays zero: the label
// check reads the header only and does not verify the CRC (nor inflate the pixels).

describe('readPngHeader', () => {
	it('reads width, height, bit depth and colour type from IHDR', () => {
		const bytes = labelPngBytes({ width: 639, height: 479, bitDepth: 8, colorType: 6 });

		expect(readPngHeader(bytes)).toEqual({ width: 639, height: 479, bitDepth: 8, colorType: 6 });
	});

	it('returns null when the first chunk is not IHDR', () => {
		expect(readPngHeader(labelPngBytes({ firstChunk: 'IDAT' }))).toBeNull();
	});

	it('returns null for a truncated header', () => {
		expect(readPngHeader(labelPngBytes().slice(0, 25))).toBeNull();
	});

	it('returns null when the signature is not a PNG', () => {
		const bytes = labelPngBytes();
		bytes[1] = 0x00;

		expect(readPngHeader(bytes)).toBeNull();
	});
});

describe('isPrintableLabelBytes', () => {
	it('accepts a 639x479 RGBA PNG', () => {
		expect(isPrintableLabelBytes(labelPngBytes())).toBe(true);
	});

	it.each([
		['8-bit RGB', { bitDepth: 8, colorType: 2 }],
		['8-bit gray', { bitDepth: 8, colorType: 0 }],
		['1-bit gray', { bitDepth: 1, colorType: 0 }]
	])('accepts %s', (_name, format) => {
		expect(isPrintableLabelBytes(labelPngBytes(format))).toBe(true);
	});

	it.each([
		['width 640', { width: 640 }],
		['width 638', { width: 638 }],
		['height 480', { height: 480 }],
		['height 478', { height: 478 }],
		['the dimensions swapped', { width: 479, height: 639 }],
		['a palette image (colorType 3)', { bitDepth: 8, colorType: 3 }],
		['16-bit RGBA', { bitDepth: 16, colorType: 6 }],
		['first chunk not IHDR', { firstChunk: 'IDAT' }]
	])('rejects %s', (_name, options) => {
		expect(isPrintableLabelBytes(labelPngBytes(options))).toBe(false);
	});

	it('rejects a truncated PNG', () => {
		expect(isPrintableLabelBytes(labelPngBytes().slice(0, 25))).toBe(false);
	});

	it('accepts exactly 64 KB and rejects one byte more', () => {
		expect(isPrintableLabelBytes(labelPngBytes({ size: 64 * 1024 }))).toBe(true);
		expect(isPrintableLabelBytes(labelPngBytes({ size: 64 * 1024 + 1 }))).toBe(false);
	});
});

describe('isPrintableLabel', () => {
	it('accepts the base64 of a printable label', () => {
		expect(isPrintableLabel(toBase64(labelPngBytes()))).toBe(true);
	});

	it('rejects a label of the wrong size', () => {
		expect(isPrintableLabel(toBase64(labelPngBytes({ width: 640, height: 480 })))).toBe(false);
	});

	it.each([
		['text that is not base64', 'not base64!!'],
		['base64 with bad padding', 'iVBORw0KGgo'],
		['an empty string', '']
	])('rejects %s', (_name, value) => {
		expect(isPrintableLabel(value)).toBe(false);
	});
});
