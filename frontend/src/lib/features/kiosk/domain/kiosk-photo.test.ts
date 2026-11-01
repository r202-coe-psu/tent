import { describe, expect, it } from 'vitest';
import {
	isCanonicalBase64,
	MAX_KIOSK_FULL_PHOTO_BYTES,
	MAX_KIOSK_THUMB_PHOTO_BYTES,
	kioskPhotoPayloadSchema
} from './kiosk-photo';

describe('kiosk card photo validation', () => {
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
