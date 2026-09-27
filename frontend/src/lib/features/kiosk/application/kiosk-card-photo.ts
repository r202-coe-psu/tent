import { compressImage } from '$lib/utils/image-compress';
import {
	detectImageMime,
	MAX_KIOSK_FULL_PHOTO_BYTES,
	MAX_KIOSK_THUMB_PHOTO_BYTES,
	type KioskPhotoMime,
	type KioskPhotoPayload
} from '../domain/kiosk-photo';

function toBase64(bytes: Uint8Array): string {
	const chunks: string[] = [];
	const chunkSize = 0x8000;
	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + chunkSize)));
	}
	return btoa(chunks.join(''));
}

function parseCardPhoto(photoBase64: string): { mime: string; encoded: string } | null {
	const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(photoBase64);
	if (match) return { mime: match[1]!, encoded: match[2]! };
	if (/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(photoBase64)) {
		return { mime: 'image/jpeg', encoded: photoBase64 };
	}
	return null;
}

async function blobBase64(blob: Blob): Promise<string> {
	return toBase64(new Uint8Array(await blob.arrayBuffer()));
}

async function getDimensions(file: File): Promise<{ width: number; height: number }> {
	try {
		const bitmap = await createImageBitmap(file);
		const dimensions = { width: bitmap.width, height: bitmap.height };
		bitmap.close();
		return dimensions;
	} catch {
		return { width: 0, height: 0 };
	}
}

/** Build a bounded request payload. Image failures never prevent walk-in registration. */
export async function buildKioskPhotoPayload(
	photoBase64: string | null | undefined
): Promise<KioskPhotoPayload | null> {
	if (!photoBase64) return null;
	const parsed = parseCardPhoto(photoBase64);
	if (!parsed) return null;

	let original: Blob;
	try {
		const response = await fetch(`data:${parsed.mime};base64,${parsed.encoded}`);
		original = await response.blob();
	} catch {
		return null;
	}
	const originalFile = new File([original], 'smart-card-photo.jpg', { type: parsed.mime });

	try {
		const compressed = await compressImage(originalFile);
		const fullBytes = new Uint8Array(await compressed.full.arrayBuffer());
		const contentType = compressed.full.type || 'image/webp';
		if (detectImageMime(fullBytes) !== contentType)
			throw new Error('Compressed image MIME mismatch');
		const fullBase64 = await blobBase64(compressed.full);
		if (compressed.full.size > MAX_KIOSK_FULL_PHOTO_BYTES) return null;
		const thumbnailBytes = new Uint8Array(await compressed.thumbnail.arrayBuffer());
		const includeThumb =
			compressed.thumbnail.size <= MAX_KIOSK_THUMB_PHOTO_BYTES &&
			detectImageMime(thumbnailBytes) === 'image/webp';
		return {
			content_type: contentType as KioskPhotoMime,
			full_base64: fullBase64,
			...(includeThumb ? { thumb_base64: await blobBase64(compressed.thumbnail) } : {}),
			width: compressed.width,
			height: compressed.height,
			original_size: compressed.originalSize,
			compressed_size: compressed.full.size,
			thumbnail_size: includeThumb ? compressed.thumbnail.size : 0
		};
	} catch {
		if (parsed.mime !== 'image/jpeg' || original.size > MAX_KIOSK_FULL_PHOTO_BYTES) return null;
		if (detectImageMime(new Uint8Array(await original.arrayBuffer())) !== 'image/jpeg') return null;
		const dimensions = await getDimensions(originalFile);
		return {
			content_type: 'image/jpeg',
			full_base64: parsed.encoded,
			...dimensions,
			original_size: original.size,
			compressed_size: original.size,
			thumbnail_size: 0
		};
	}
}
