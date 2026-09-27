// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { compressImageMock } = vi.hoisted(() => ({ compressImageMock: vi.fn() }));
vi.mock('$lib/utils/image-compress', () => ({ compressImage: compressImageMock }));

import { buildKioskPhotoPayload } from './kiosk-card-photo';

describe('buildKioskPhotoPayload', () => {
	const fetchMock = vi.fn();

	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal('fetch', fetchMock);
		fetchMock.mockResolvedValue(
			new Response(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), {
				headers: { 'content-type': 'image/jpeg' }
			})
		);
	});

	afterEach(() => vi.unstubAllGlobals());

	it('returns null when the card has no photo', async () => {
		await expect(buildKioskPhotoPayload(null)).resolves.toBeNull();
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('compresses a card photo to bounded webp attachments', async () => {
		const webpBytes = new Uint8Array([
			0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
		]);
		compressImageMock.mockResolvedValue({
			full: new Blob([webpBytes], { type: 'image/webp' }),
			thumbnail: new Blob([webpBytes], { type: 'image/webp' }),
			width: 500,
			height: 600,
			originalSize: 4,
			compressedSize: 12,
			thumbnailSize: 12
		});

		const result = await buildKioskPhotoPayload('data:image/jpeg;base64,/9j/AA==');

		expect(result).toMatchObject({
			content_type: 'image/webp',
			width: 500,
			height: 600,
			original_size: 4,
			compressed_size: 12,
			thumbnail_size: 12
		});
		expect(result?.full_base64).toBe(btoa(String.fromCharCode(...webpBytes)));
		expect(result?.thumb_base64).toBe(btoa(String.fromCharCode(...webpBytes)));
		expect(compressImageMock).toHaveBeenCalledOnce();
	});

	it('falls back to the original jpeg without a thumbnail when compression fails', async () => {
		compressImageMock.mockRejectedValue(new Error('canvas unavailable'));

		const result = await buildKioskPhotoPayload('data:image/jpeg;base64,/9j/AA==');

		expect(result).toEqual({
			content_type: 'image/jpeg',
			full_base64: '/9j/AA==',
			width: 0,
			height: 0,
			original_size: 4,
			compressed_size: 4,
			thumbnail_size: 0
		});
	});
});
