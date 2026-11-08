import { kioskLabelDots } from '$lib/utils/label-size';

export const MAX_LABEL_PNG_BYTES = 64 * 1024;

export type PngHeader = { width: number; height: number; bitDepth: number; colorType: number };

/**
 * PNG (bitDepth, colorType) pairs a label may use. TEAM PROPOSAL, to be confirmed on the real
 * tablet browser: (8,6) RGBA is what Chrome's `canvas.toDataURL('image/png')` emits, (8,2) RGB and
 * (8,0) gray cover other encoders, (1,0) 1-bit gray is the server's own test label. Palette
 * (colorType 3), gray+alpha and 16-bit images are not accepted.
 */
export const LABEL_PNG_FORMATS: readonly (readonly [bitDepth: number, colorType: number])[] = [
	[8, 6],
	[8, 2],
	[8, 0],
	[1, 0]
];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const IHDR_LENGTH = 13;
const IHDR_TYPE = [0x49, 0x48, 0x44, 0x52];
/** Signature (8) + chunk length (4) + type (4) + width/height (8) + bit depth + colour type. */
const HEADER_BYTES = 26;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/** Decoded size of a well-formed base64 string, without decoding it. */
export function base64DecodedBytes(base64: string): number {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return (base64.length / 4) * 3 - padding;
}

/**
 * Reads the IHDR of a PNG, or null when the signature or the leading IHDR chunk is missing or the
 * bytes are truncated. The CRC is not verified and the pixel data is not inflated.
 */
export function readPngHeader(bytes: Uint8Array): PngHeader | null {
	if (bytes.length < HEADER_BYTES) return null;
	if (!PNG_SIGNATURE.every((byte, i) => bytes[i] === byte)) return null;
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.getUint32(8) !== IHDR_LENGTH) return null;
	if (!IHDR_TYPE.every((byte, i) => bytes[12 + i] === byte)) return null;
	return {
		width: view.getUint32(16),
		height: view.getUint32(20),
		bitDepth: bytes[24],
		colorType: bytes[25]
	};
}

/** True when `bytes` is a PNG of at most 64 KB, exactly one label in size, in an allowed format. */
export function isPrintableLabelBytes(bytes: Uint8Array): boolean {
	if (bytes.length > MAX_LABEL_PNG_BYTES) return false;
	const header = readPngHeader(bytes);
	if (!header) return false;
	const { width, height } = kioskLabelDots();
	if (header.width !== width || header.height !== height) return false;
	return LABEL_PNG_FORMATS.some(
		([bitDepth, colorType]) => bitDepth === header.bitDepth && colorType === header.colorType
	);
}

/** One label as base64: well-formed, then `isPrintableLabelBytes` on the decoded PNG. */
export function isPrintableLabel(base64: string): boolean {
	if (!BASE64.test(base64) || base64DecodedBytes(base64) > MAX_LABEL_PNG_BYTES) return false;
	try {
		// atob exists in browsers and Node 16+, unlike Buffer.
		return isPrintableLabelBytes(Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)));
	} catch {
		return false;
	}
}
