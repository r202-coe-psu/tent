import {
	KIOSK_BANNER_IMAGE_MAX_BYTES,
	KIOSK_BANNER_IMAGE_TYPES
} from '../domain/kiosk-banner-image';

export interface BannerImagePayload {
	content_type: string;
	data_base64: string;
}

const CHUNK = 0x8000;

/**
 * Client-side UX pre-check (FR-KBR-04). The server re-validates by magic bytes; this only saves a
 * round trip. Returns a Thai message, or `null` when the file looks acceptable.
 */
export function validateBannerFile(file: File): string | null {
	if (!(KIOSK_BANNER_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		return 'รองรับเฉพาะรูป png / jpeg / webp';
	}
	if (file.size === 0) return 'ไม่พบข้อมูลรูปภาพ';
	if (file.size > KIOSK_BANNER_IMAGE_MAX_BYTES) return 'รูปภาพต้องมีขนาดไม่เกิน 2 MB';
	return null;
}

/** Read a file into the `{ content_type, data_base64 }` shape the banner API expects. */
export async function readBannerFile(file: File): Promise<BannerImagePayload> {
	const bytes = new Uint8Array(await file.arrayBuffer());
	let binary = '';
	for (let i = 0; i < bytes.length; i += CHUNK) {
		binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
	}
	return { content_type: file.type, data_base64: btoa(binary) };
}
