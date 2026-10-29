import { compressImage, type CompressResult } from '$lib/utils/image-compress';
import { DONATION_PHOTO_COMPRESS } from '../domain/donation-photos';

export interface CompressedDonorPhoto {
	compressed: CompressResult;
	/** `full` + `thumb`, what the booking's 10 MB counts (FR-7). */
	bytes: number;
}

const SENDABLE = new Set(['image/webp', 'image/jpeg']);

/**
 * FR-5: `full` 1600 px q0.8 and a 200 px thumb, WEBP. Safari cannot encode WEBP and
 * silently returns PNG, which the upload BFF refuses (FR-6 takes JPEG/WEBP only), so
 * that case is encoded again as JPEG.
 */
export async function compressDonorPhoto(file: File): Promise<CompressedDonorPhoto> {
	let compressed = await compressImage(file, DONATION_PHOTO_COMPRESS);
	if (!SENDABLE.has(compressed.full.type) || !SENDABLE.has(compressed.thumbnail.type)) {
		compressed = await compressImage(file, { ...DONATION_PHOTO_COMPRESS, mimeType: 'image/jpeg' });
	}
	return { compressed, bytes: compressed.compressedSize + compressed.thumbnailSize };
}

export class DonorPhotoUploadError extends Error {
	constructor(readonly code: string) {
		super(code);
		this.name = 'DonorPhotoUploadError';
	}
}

/** `POST /api/public/v1/donations/photos` (FR-8) → the new photo's `image:{ulid}`. */
export async function uploadDonorPhoto(
	shelterCode: string,
	file: File,
	{ compressed }: CompressedDonorPhoto
): Promise<string> {
	const form = new FormData();
	form.append('shelter_code', shelterCode);
	form.append('full', compressed.full, file.name);
	form.append('thumb', compressed.thumbnail, 'thumb');
	form.append('filename', file.name);
	form.append('width', String(compressed.width));
	form.append('height', String(compressed.height));
	form.append('original_size', String(compressed.originalSize));

	const res = await fetch('/api/public/v1/donations/photos', { method: 'POST', body: form });
	const body = (await res.json().catch(() => null)) as {
		success?: boolean;
		photo_id?: string;
		error?: string;
	} | null;
	if (!res.ok || !body?.success || !body.photo_id) {
		throw new DonorPhotoUploadError(body?.error ?? 'UPLOAD_FAILED');
	}
	return body.photo_id;
}
