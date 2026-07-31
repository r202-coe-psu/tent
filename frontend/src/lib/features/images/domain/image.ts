import type { BaseDoc } from '$lib/db/model';

/**
 * Domain for the `image` doc type (docs/data/schema.md §1.6, CR-049).
 * Pure TypeScript. No Svelte, no DOM, no DB calls.
 *
 * Reusable across features — the binary bytes live in CouchDB attachments
 * (`full`, `thumb`), never inline on the document.
 */

export interface ImageDoc extends BaseDoc {
	type: 'image';
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
