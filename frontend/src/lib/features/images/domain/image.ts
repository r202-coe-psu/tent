import type { BaseDoc } from '$lib/db/model';

/**
 * Domain for the `image` doc type (docs/data/schema.md §1.6, CR-049).
 * Pure TypeScript. No Svelte, no DOM, no DB calls.
 *
 * Reusable across features — the binary bytes live in CouchDB attachments
 * (`full`, `thumb`), never inline on the document.
 */

/**
 * `image` schema_v every writer stamps (schema.md §1.6). 2 added the optional
 * `purpose` / `donation_id` (CR-175 donor photos); a doc without `purpose` is a
 * people-plane photo.
 */
export const IMAGE_SCHEMA_V = 2;

/** Set only on a donor's donation photo; the orphan sweep keys on it (CR-175 FR-16). */
export type ImagePurpose = 'donation';

export interface ImageDoc extends BaseDoc {
	type: 'image';
	purpose?: ImagePurpose;
	/** The `donation:{ulid}` a donation photo is bound to, written by the worker (FR-11a). */
	donation_id?: string;
	filename: string;
	content_type: string;
	width: number;
	height: number;
	original_size: number;
	compressed_size: number;
	thumbnail_size: number;
	caption: string;
}

export function isImageDoc(d: unknown): d is ImageDoc {
	return (
		typeof d === 'object' &&
		d !== null &&
		(d as ImageDoc).type === 'image' &&
		typeof (d as ImageDoc).filename === 'string'
	);
}

export interface ImageSummary {
	_id: string;
	_rev: string;
	filename: string;
	content_type: string;
	width: number;
	height: number;
	original_size: number;
	compressed_size: number;
	thumbnail_size: number;
	caption: string;
	created_at: string;
}

export type ImageMime = 'image/jpeg' | 'image/webp';

/** The image type the bytes really are, read from their signature — never from `content-type`. */
export function detectImageMime(bytes: Uint8Array): ImageMime | null {
	if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return 'image/jpeg';
	}
	if (
		bytes.length >= 12 &&
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return 'image/webp';
	}
	return null;
}
