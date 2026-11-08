/**
 * Test helper: the first bytes of a PNG (signature + IHDR chunk), padded with zeros up to `size`.
 * Not a decodable image and the CRC is left as zeros — label validation only reads the header, it
 * never inflates the pixels or verifies the CRC. Defaults describe a valid kiosk label.
 */
export type LabelPngOptions = {
	width?: number;
	height?: number;
	bitDepth?: number;
	colorType?: number;
	/** Chunk type of the first chunk; a real PNG always starts with IHDR. */
	firstChunk?: string;
	/** Total decoded size in bytes (at least 33: signature 8 + IHDR chunk 25). */
	size?: number;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const HEADER_BYTES = 33;

export function labelPngBytes(options: LabelPngOptions = {}): Uint8Array {
	const {
		width = 639,
		height = 479,
		bitDepth = 8,
		colorType = 6,
		firstChunk = 'IHDR',
		size = HEADER_BYTES
	} = options;
	const bytes = new Uint8Array(Math.max(size, HEADER_BYTES));
	const view = new DataView(bytes.buffer);
	bytes.set(PNG_SIGNATURE, 0);
	view.setUint32(8, 13);
	bytes.set(
		Array.from(firstChunk, (char) => char.charCodeAt(0)),
		12
	);
	view.setUint32(16, width);
	view.setUint32(20, height);
	bytes[24] = bitDepth;
	bytes[25] = colorType;
	return bytes;
}

export function toBase64(bytes: Uint8Array): string {
	return Buffer.from(bytes).toString('base64');
}

/** Base64 of a valid-looking 639x479 label PNG header (see `labelPngBytes`). */
export function labelPngBase64(options: LabelPngOptions = {}): string {
	return toBase64(labelPngBytes(options));
}
