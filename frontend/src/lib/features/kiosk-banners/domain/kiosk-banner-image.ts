export const KIOSK_BANNER_IMAGE_MAX_BYTES = 2 * 1024 * 1024;

export const KIOSK_BANNER_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;

export type KioskBannerImageMime = (typeof KIOSK_BANNER_IMAGE_TYPES)[number];

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff];
const RIFF = [0x52, 0x49, 0x46, 0x46];
const WEBP = [0x57, 0x45, 0x42, 0x50];

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const isCanonicalBase64 = (value: string): boolean =>
	value.length > 0 && value.length % 4 === 0 && BASE64_PATTERN.test(value);

const decodedLength = (base64: string): number => {
	const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
	return (base64.length / 4) * 3 - padding;
};

const matchesAt = (bytes: Uint8Array, offset: number, signature: readonly number[]): boolean =>
	bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

export function detectBannerImageMime(bytes: Uint8Array): KioskBannerImageMime | null {
	if (matchesAt(bytes, 0, PNG_SIGNATURE)) return 'image/png';
	if (matchesAt(bytes, 0, JPEG_SIGNATURE)) return 'image/jpeg';
	if (matchesAt(bytes, 0, RIFF) && matchesAt(bytes, 8, WEBP)) return 'image/webp';
	return null;
}

export type DecodeBannerImageResult =
	| { ok: true; bytes: Uint8Array; contentType: KioskBannerImageMime }
	| { ok: false; reason: 'invalid_base64' | 'too_large' | 'unsupported_type' | 'empty' };

/** `maxBytes` defaults to the banner cap; footer logos pass their own 512 KB (CR-184 FR-5). */
export function decodeBannerImage(
	payload: { content_type: string; data_base64: string },
	maxBytes: number = KIOSK_BANNER_IMAGE_MAX_BYTES
): DecodeBannerImageResult {
	if (payload.data_base64.length === 0) return { ok: false, reason: 'empty' };
	if (!isCanonicalBase64(payload.data_base64)) return { ok: false, reason: 'invalid_base64' };
	if (decodedLength(payload.data_base64) > maxBytes) {
		return { ok: false, reason: 'too_large' };
	}
	const binary = atob(payload.data_base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
	const contentType = detectBannerImageMime(bytes);
	if (!contentType) return { ok: false, reason: 'unsupported_type' };
	return { ok: true, bytes, contentType };
}
