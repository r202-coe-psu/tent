// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { compressImage, formatBytes, compressionRatio } from './image-compress';

// Canvas rendering / image decoding are unavailable in happy-dom, so — like
// pdf.test.ts mocks html2canvas-pro — we mock the Image/Canvas boundary
// itself and assert on the resize math + pass-through args compressImage
// computes, not on real pixel output.
let nextImage = { width: 1024, height: 1024, shouldError: false };

class FakeImage {
	onload: (() => void) | null = null;
	onerror: (() => void) | null = null;
	naturalWidth = 0;
	naturalHeight = 0;

	set src(_value: string) {
		const config = nextImage;
		queueMicrotask(() => {
			if (config.shouldError) {
				this.onerror?.();
				return;
			}
			this.naturalWidth = config.width;
			this.naturalHeight = config.height;
			this.onload?.();
		});
	}
}

const drawImageMock = vi.fn();
const toBlobCalls: Array<{ width: number; height: number; mimeType: string; quality: number }> = [];

beforeEach(() => {
	nextImage = { width: 1024, height: 1024, shouldError: false };
	drawImageMock.mockClear();
	toBlobCalls.length = 0;

	vi.stubGlobal('Image', FakeImage);

	vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
		drawImage: drawImageMock
	} as unknown as CanvasRenderingContext2D);

	vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
		this: HTMLCanvasElement,
		callback: BlobCallback,
		mimeType?: string,
		quality?: number
	) {
		toBlobCalls.push({
			width: this.width,
			height: this.height,
			mimeType: mimeType ?? '',
			quality: quality ?? 0
		});
		// One byte of blob content per canvas pixel — lets tests assert
		// full vs. thumbnail blobs are distinguishable without a real codec.
		callback(new Blob([new Uint8Array(this.width * this.height)], { type: mimeType }));
	});
});

function fakeFile(name: string, size: number, type = 'image/jpeg'): File {
	return new File([new Uint8Array(size)], name, { type });
}

describe('compressImage', () => {
	it('downscales a landscape image so width caps at maxPx, preserving aspect ratio', async () => {
		nextImage = { width: 2000, height: 1000, shouldError: false };
		const result = await compressImage(fakeFile('a.jpg', 5000));

		expect(result.width).toBe(1024);
		expect(result.height).toBe(512);
	});

	it('downscales a portrait image so height caps at maxPx, preserving aspect ratio', async () => {
		nextImage = { width: 1000, height: 2000, shouldError: false };
		const result = await compressImage(fakeFile('a.jpg', 5000));

		expect(result.height).toBe(1024);
		expect(result.width).toBe(512);
	});

	it('leaves dimensions untouched when already within maxPx', async () => {
		nextImage = { width: 800, height: 600, shouldError: false };
		const result = await compressImage(fakeFile('a.jpg', 5000));

		expect(result.width).toBe(800);
		expect(result.height).toBe(600);
	});

	it('honors a custom maxPx / thumbPx / quality / mimeType', async () => {
		nextImage = { width: 2000, height: 1000, shouldError: false };
		await compressImage(fakeFile('a.jpg', 5000), { maxPx: 500, thumbPx: 100, quality: 0.5 });

		// Full canvas: 500x250 at quality 0.5; thumb canvas: 100x100 at quality 0.5.
		expect(toBlobCalls).toEqual([
			expect.objectContaining({ width: 500, height: 250, quality: 0.5 }),
			expect.objectContaining({ width: 100, height: 100, quality: 0.5 })
		]);
	});

	it('center-crops the thumbnail from the largest square in the source image', async () => {
		nextImage = { width: 2000, height: 1000, shouldError: false };
		await compressImage(fakeFile('a.jpg', 5000), { thumbPx: 200 });

		// Second drawImage call renders the thumbnail: square crop of size
		// min(w,h)=1000 centered horizontally (srcX = (2000-1000)/2 = 500), srcY = 0.
		expect(drawImageMock).toHaveBeenCalledTimes(2);
		expect(drawImageMock).toHaveBeenNthCalledWith(
			2,
			expect.anything(),
			500,
			0,
			1000,
			1000,
			0,
			0,
			200,
			200
		);
	});

	it('reports originalSize from the input File and compressedSize/thumbnailSize from the encoded blobs', async () => {
		nextImage = { width: 1024, height: 1024, shouldError: false };
		const file = fakeFile('a.jpg', 12345);
		const result = await compressImage(file);

		expect(result.originalSize).toBe(12345);
		expect(result.compressedSize).toBe(result.full.size);
		expect(result.thumbnailSize).toBe(result.thumbnail.size);
	});

	it('rejects when the image fails to decode', async () => {
		nextImage = { width: 0, height: 0, shouldError: true };
		await expect(compressImage(fakeFile('bad.jpg', 10))).rejects.toThrow('Failed to load image');
	});

	it('rejects when canvas encoding produces no blob', async () => {
		vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
			callback: BlobCallback
		) {
			callback(null);
		});

		await expect(compressImage(fakeFile('a.jpg', 10))).rejects.toThrow(
			'Canvas toBlob returned null'
		);
	});
});

describe('formatBytes', () => {
	it('formats zero bytes', () => {
		expect(formatBytes(0)).toBe('0 B');
	});

	it('formats sub-kilobyte sizes as bytes', () => {
		expect(formatBytes(500)).toBe('500 B');
	});

	it('formats kilobytes with one decimal place', () => {
		expect(formatBytes(1536)).toBe('1.5 KB');
	});

	it('formats megabytes', () => {
		expect(formatBytes(1048576)).toBe('1 MB');
	});

	it('formats gigabytes', () => {
		expect(formatBytes(1073741824)).toBe('1 GB');
	});
});

describe('compressionRatio', () => {
	it('computes the percentage saved', () => {
		expect(compressionRatio(100, 50)).toBe('50%');
	});

	it('returns 0% when original size is 0 (avoids divide-by-zero)', () => {
		expect(compressionRatio(0, 50)).toBe('0%');
	});

	it('returns 0% when compression saved nothing', () => {
		expect(compressionRatio(100, 100)).toBe('0%');
	});

	it('returns a negative percentage when the "compressed" file grew', () => {
		expect(compressionRatio(100, 150)).toBe('-50%');
	});
});
