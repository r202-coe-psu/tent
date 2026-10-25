import { compressImage } from '$lib/utils/image-compress';
import { FOOTER_LOGO_TOO_LARGE_MESSAGE, validateFooterLogoFile } from '../domain/footer-logo';

/** 3× the 176 px max render width (FR-17a) covers high-DPI screens. */
const LOGO_MAX_PX = 512;
const LOGO_QUALITY = 0.85;

export type FooterLogoUpload = { ok: true; file: File } | { ok: false; error: string };

/**
 * Shrinks a picked logo to WebP (keeps transparency) so designer-sized files fit the 512 KB cap.
 * Keeps the original when re-encoding would not make it smaller.
 */
export async function prepareFooterLogoUpload(
	picked: File,
	compress: typeof compressImage = compressImage
): Promise<FooterLogoUpload> {
	const pickedError = validateFooterLogoFile(picked);
	if (pickedError && pickedError !== FOOTER_LOGO_TOO_LARGE_MESSAGE) {
		return { ok: false, error: pickedError };
	}

	let blob: Blob;
	try {
		blob = (
			await compress(picked, {
				maxPx: LOGO_MAX_PX,
				quality: LOGO_QUALITY,
				mimeType: 'image/webp'
			})
		).full;
	} catch {
		return { ok: false, error: 'ไม่สามารถอ่านไฟล์รูปภาพได้' };
	}

	// Safari may ignore the WebP request and encode PNG, so name the file from the blob's real type.
	const extension = blob.type.split('/')[1] ?? 'webp';
	const file =
		blob.size < picked.size
			? new File([blob], `${picked.name.replace(/\.[^.]+$/, '')}.${extension}`, {
					type: blob.type
				})
			: picked;
	const error = validateFooterLogoFile(file);
	return error ? { ok: false, error } : { ok: true, file };
}
