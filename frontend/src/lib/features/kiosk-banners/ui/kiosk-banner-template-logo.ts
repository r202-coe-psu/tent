import { compressImage } from '$lib/utils/image-compress';
import { KIOSK_BANNER_IMAGE_TYPES } from '../domain/kiosk-banner-image';
import {
	TEMPLATE_IMAGE_MAX_BYTES,
	TEMPLATE_IMAGE_TOO_LARGE_MESSAGE
} from '../domain/kiosk-banner-template';

/** The logo is drawn at most ~a third of the screen's short side; 1024 px keeps it sharp. */
const LOGO_MAX_PX = 1024;
const LOGO_QUALITY = 0.85;

export type TemplateLogo = { ok: true; file: File } | { ok: false; error: string };

/**
 * Shrinks a picked logo to WebP so a phone photo fits the 512 KB `template_image` cap. Keeps the
 * original when re-encoding would not make it smaller.
 */
export async function prepareTemplateLogo(
	picked: File,
	compress: typeof compressImage = compressImage
): Promise<TemplateLogo> {
	if (!(KIOSK_BANNER_IMAGE_TYPES as readonly string[]).includes(picked.type)) {
		return { ok: false, error: 'รองรับเฉพาะรูป png / jpeg / webp' };
	}
	if (picked.size === 0) return { ok: false, error: 'ไม่พบข้อมูลรูปภาพ' };

	let blob: Blob;
	try {
		blob = (
			await compress(picked, { maxPx: LOGO_MAX_PX, quality: LOGO_QUALITY, mimeType: 'image/webp' })
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
	return file.size > TEMPLATE_IMAGE_MAX_BYTES
		? { ok: false, error: TEMPLATE_IMAGE_TOO_LARGE_MESSAGE }
		: { ok: true, file };
}
