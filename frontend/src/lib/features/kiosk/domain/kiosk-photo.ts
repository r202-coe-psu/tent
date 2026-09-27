import { z } from 'zod';

export const MAX_KIOSK_FULL_PHOTO_BYTES = 300 * 1024;
export const MAX_KIOSK_THUMB_PHOTO_BYTES = 50 * 1024;

export type KioskPhotoMime = 'image/jpeg' | 'image/webp';

const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export const kioskPhotoPayloadSchema = z
	.object({
		content_type: z.enum(['image/jpeg', 'image/webp']),
		full_base64: z
			.string()
			.min(4)
			.max(Math.ceil((MAX_KIOSK_FULL_PHOTO_BYTES + 2) / 3) * 4)
			.regex(base64Pattern),
		thumb_base64: z
			.string()
			.min(4)
			.max(Math.ceil((MAX_KIOSK_THUMB_PHOTO_BYTES + 2) / 3) * 4)
			.regex(base64Pattern)
			.optional(),
		width: z.number().int().nonnegative().max(10_000),
		height: z.number().int().nonnegative().max(10_000),
		original_size: z.number().int().nonnegative().max(2_000_000),
		compressed_size: z.number().int().nonnegative(),
		thumbnail_size: z.number().int().nonnegative()
	})
	.strict();

export type KioskPhotoPayload = z.infer<typeof kioskPhotoPayloadSchema>;

export function detectImageMime(bytes: Uint8Array): KioskPhotoMime | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}

export function isCanonicalBase64(value: string): boolean {
	return value.length > 0 && value.length % 4 === 0 && base64Pattern.test(value);
}
