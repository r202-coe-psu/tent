/**
 * Domain definitions for the POC image feature.
 * Pure TypeScript. No Svelte, no DOM, no DB calls.
 */

export interface ImageDoc {
	_id: string;
	_rev?: string;
	type: 'poc_image';
	schema_v: 1;
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

export function isImageDoc(d: unknown): d is ImageDoc {
	return (
		typeof d === 'object' &&
		d !== null &&
		(d as ImageDoc).type === 'poc_image' &&
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
