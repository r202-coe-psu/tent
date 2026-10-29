import { describe, expect, it } from 'vitest';
import { detectImageMime } from './image';

describe('detectImageMime', () => {
	it('recognizes JPEG and WEBP signatures only', () => {
		expect(detectImageMime(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
		expect(
			detectImageMime(
				Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50])
			)
		).toBe('image/webp');
		expect(detectImageMime(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]))).toBeNull();
	});

	it('reads a text file renamed to .jpg as not an image', () => {
		expect(detectImageMime(new TextEncoder().encode('hello, not a photo'))).toBeNull();
		expect(detectImageMime(new Uint8Array())).toBeNull();
	});
});
