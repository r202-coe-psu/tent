import { describe, expect, it } from 'vitest';
import {
	detectImageMime,
	isCanonicalBase64,
	MAX_KIOSK_FULL_PHOTO_BYTES,
	MAX_KIOSK_THUMB_PHOTO_BYTES,
	kioskPhotoPayloadSchema
} from './kiosk-photo';

describe('kiosk card photo validation', () => {
	it('recognizes JPEG and WEBP signatures only', () => {
		expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
		expect(
			detectImageMime(
				Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
			)
		).toBe('image/webp');
		expect(detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
	});

	it('accepts only canonical base64 strings and caps payload sizes', () => {
		expect(isCanonicalBase64('/9j/AA==')).toBe(true);
		expect(isCanonicalBase64('data:image/jpeg;base64,/9j/AA==')).toBe(false);
		expect(kioskPhotoPayloadSchema.shape.full_base64.safeParse('A'.repeat(500_000)).success).toBe(
			false
		);
		expect(MAX_KIOSK_FULL_PHOTO_BYTES).toBe(300 * 1024);
		expect(MAX_KIOSK_THUMB_PHOTO_BYTES).toBe(50 * 1024);
	});
});
