/**
 * PouchDB repository for the POC image feature.
 *
 * Stores images as CouchDB **Attachments** (binary, not base64 inline).
 * Each image document has two attachments:
 *   - "full"  — compressed JPEG (max 1024px)
 *   - "thumb" — square-cropped JPEG thumbnail (200px)
 *
 * POC uses a local-only database named `poc_media`.
 * Pattern is identical to any shelter DB — swap `POC_DB` with `shelter_{code}`
 * to migrate to production.
 */

import { namedLocalDb, startNamedSync, stopNamedSync } from '$lib/db/pouch';
import { ulid } from '$lib/db/ulid';
import { compressImage, type CompressOptions } from '$lib/utils/image-compress';

export const POC_DB = 'poc_media';

// ---------------------------------------------------------------- schema

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

// ---------------------------------------------------------------- image summary (for listing — no attachment blobs)

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

// ---------------------------------------------------------------- repository

export class PocImageRepository {
	private readonly db: PouchDB.Database;

	constructor(dbName: string = POC_DB) {
		this.db = namedLocalDb(dbName);
	}

	/**
	 * Compress a File and store it as a CouchDB attachment document.
	 * Returns the saved ImageDoc (without attachment blobs).
	 */
	async saveImage(
		file: File,
		caption: string = '',
		opts: CompressOptions = {}
	): Promise<ImageSummary> {
		const compressed = await compressImage(file, opts);
		const id = `poc_image:${ulid()}`;

		// 1. Create the metadata document first
		const doc: ImageDoc = {
			_id: id,
			type: 'poc_image',
			schema_v: 1,
			filename: file.name,
			content_type: compressed.full.type || 'image/jpeg',
			width: compressed.width,
			height: compressed.height,
			original_size: compressed.originalSize,
			compressed_size: compressed.compressedSize,
			thumbnail_size: compressed.thumbnailSize,
			caption,
			created_at: new Date().toISOString()
		};

		const putResult = await this.db.put(doc);

		// 2. Attach the full image — putAttachment returns { ok, id, rev }
		const fullResult = await this.db.putAttachment(
			id,
			'full',
			putResult.rev,
			compressed.full,
			compressed.full.type || 'image/jpeg'
		) as { ok: boolean; id: string; rev: string };

		// 3. Attach the thumbnail using the rev returned from step 2
		await this.db.putAttachment(
			id,
			'thumb',
			fullResult.rev,
			compressed.thumbnail,
			compressed.thumbnail.type || 'image/jpeg'
		);

		return this.getImageSummary(id) as Promise<ImageSummary>;
	}

	/** List all image documents (metadata only — no attachment blobs). */
	async listImages(): Promise<ImageSummary[]> {
		const res = await this.db.allDocs({
			include_docs: true,
			startkey: 'poc_image:',
			endkey: 'poc_image:￰'
		});

		return res.rows
			.map((r) => r.doc as unknown)
			.filter((d): d is ImageDoc => isImageDoc(d))
			.map((d) => ({
				_id: d._id,
				_rev: d._rev!,
				filename: d.filename,
				content_type: d.content_type,
				width: d.width,
				height: d.height,
				original_size: d.original_size,
				compressed_size: d.compressed_size,
				thumbnail_size: d.thumbnail_size,
				caption: d.caption,
				created_at: d.created_at
			}));
	}

	/** Get metadata for a single image. */
	async getImageSummary(id: string): Promise<ImageSummary | null> {
		try {
			const doc = await this.db.get<ImageDoc>(id);
			return {
				_id: doc._id,
				_rev: doc._rev!,
				filename: doc.filename,
				content_type: doc.content_type,
				width: doc.width,
				height: doc.height,
				original_size: doc.original_size,
				compressed_size: doc.compressed_size,
				thumbnail_size: doc.thumbnail_size,
				caption: doc.caption,
				created_at: doc.created_at
			};
		} catch (e) {
			if ((e as { status?: number }).status === 404) return null;
			throw e;
		}
	}

	/**
	 * Fetch the full-size image attachment as an object URL string.
	 * Caller is responsible for calling URL.revokeObjectURL() when done.
	 */
	async getFullImageUrl(id: string): Promise<string | null> {
		try {
			const blob = await this.db.getAttachment(id, 'full');
			return URL.createObjectURL(blob as Blob);
		} catch (e) {
			if ((e as { status?: number }).status === 404) return null;
			throw e;
		}
	}

	/**
	 * Fetch the thumbnail attachment as an object URL string.
	 * Caller is responsible for calling URL.revokeObjectURL() when done.
	 */
	async getThumbnailUrl(id: string): Promise<string | null> {
		try {
			const blob = await this.db.getAttachment(id, 'thumb');
			return URL.createObjectURL(blob as Blob);
		} catch (e) {
			if ((e as { status?: number }).status === 404) return null;
			throw e;
		}
	}

	/** Delete an image document and all its attachments. */
	async deleteImage(id: string): Promise<void> {
		const doc = await this.db.get(id);
		await this.db.remove(doc);
	}

	/** Start live sync with a remote CouchDB instance (cookie auth). */
	startSync(onAuthError?: (status: number) => void): void {
		startNamedSync(POC_DB, onAuthError);
	}

	/** Stop live sync. */
	stopSync(): void {
		stopNamedSync(POC_DB);
	}

	/** Listen to changes feed for reactivity. */
	watchChanges(onChange: () => void): () => void {
		const feed = this.db.changes({ live: true, since: 'now' });
		feed.on('change', onChange);
		return () => feed.cancel();
	}
}

// Singleton
let _repo: PocImageRepository | null = null;
export function pocImageRepository(): PocImageRepository {
	if (!_repo) _repo = new PocImageRepository();
	return _repo;
}
