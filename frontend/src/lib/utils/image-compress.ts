/**
 * Client-side image compression using the Canvas API (no external deps).
 *
 * Resizes the image so neither dimension exceeds `maxPx` (default 1024),
 * then encodes to JPEG at the given quality (default 0.82).
 * Also produces a square-cropped thumbnail at `thumbPx` (default 200).
 */

export interface CompressOptions {
	/** Max width or height in pixels (aspect-ratio preserved). Default: 1024 */
	maxPx?: number;
	/** Thumbnail size (square crop). Default: 200 */
	thumbPx?: number;
	/** JPEG quality 0-1. Default: 0.82 */
	quality?: number;
	/** Output mime type. Default: 'image/jpeg' */
	mimeType?: 'image/jpeg' | 'image/webp';
}

export interface CompressResult {
	full: Blob;
	thumbnail: Blob;
	width: number;
	height: number;
	originalSize: number;
	compressedSize: number;
	thumbnailSize: number;
}

/** Load a File/Blob into an HTMLImageElement. */
function loadImage(blob: Blob): Promise<HTMLImageElement> {
	return new Promise((resolve, reject) => {
		const img = new Image();
		const url = URL.createObjectURL(blob);
		img.onload = () => {
			URL.revokeObjectURL(url);
			resolve(img);
		};
		img.onerror = () => {
			URL.revokeObjectURL(url);
			reject(new Error('Failed to load image'));
		};
		img.src = url;
	});
}

/** Draw image into a canvas and return a Blob. */
function canvasToBlob(
	canvas: HTMLCanvasElement,
	mimeType: string,
	quality: number
): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(blob) => {
				if (blob) resolve(blob);
				else reject(new Error('Canvas toBlob returned null'));
			},
			mimeType,
			quality
		);
	});
}

/**
 * Compress a File (image) and generate a thumbnail.
 *
 * @param file - The original image File from an <input> or camera.
 * @param opts - Compression options.
 * @returns CompressResult with full + thumbnail Blobs and metadata.
 */
export async function compressImage(file: File, opts: CompressOptions = {}): Promise<CompressResult> {
	const {
		maxPx = 1024,
		thumbPx = 200,
		quality = 0.82,
		mimeType = 'image/jpeg'
	} = opts;

	const img = await loadImage(file);

	// --- Full-size (aspect-ratio preserving resize) ---
	let w = img.naturalWidth;
	let h = img.naturalHeight;

	if (w > maxPx || h > maxPx) {
		if (w >= h) {
			h = Math.round((h * maxPx) / w);
			w = maxPx;
		} else {
			w = Math.round((w * maxPx) / h);
			h = maxPx;
		}
	}

	const fullCanvas = document.createElement('canvas');
	fullCanvas.width = w;
	fullCanvas.height = h;
	const fullCtx = fullCanvas.getContext('2d')!;
	fullCtx.drawImage(img, 0, 0, w, h);
	const fullBlob = await canvasToBlob(fullCanvas, mimeType, quality);

	// --- Thumbnail (center square crop) ---
	const thumbCanvas = document.createElement('canvas');
	thumbCanvas.width = thumbPx;
	thumbCanvas.height = thumbPx;
	const thumbCtx = thumbCanvas.getContext('2d')!;

	// Center-crop: take the largest square from center of original image
	const srcSize = Math.min(img.naturalWidth, img.naturalHeight);
	const srcX = (img.naturalWidth - srcSize) / 2;
	const srcY = (img.naturalHeight - srcSize) / 2;
	thumbCtx.drawImage(img, srcX, srcY, srcSize, srcSize, 0, 0, thumbPx, thumbPx);
	const thumbBlob = await canvasToBlob(thumbCanvas, mimeType, quality);

	return {
		full: fullBlob,
		thumbnail: thumbBlob,
		width: w,
		height: h,
		originalSize: file.size,
		compressedSize: fullBlob.size,
		thumbnailSize: thumbBlob.size
	};
}

/** Human-readable file size: "1.2 MB", "450 KB", etc. */
export function formatBytes(bytes: number): string {
	if (bytes === 0) return '0 B';
	const k = 1024;
	const sizes = ['B', 'KB', 'MB', 'GB'];
	const i = Math.floor(Math.log(bytes) / Math.log(k));
	return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/** Compression ratio percentage: "saved 72%" */
export function compressionRatio(original: number, compressed: number): string {
	if (original === 0) return '0%';
	const saved = ((original - compressed) / original) * 100;
	return `${Math.round(saved)}%`;
}
