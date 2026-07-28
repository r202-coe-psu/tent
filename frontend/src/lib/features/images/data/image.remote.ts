/**
 * Remote CouchDB repository for the `images` feature (docs/data/schema.md §1.6,
 * CR-049). Stores images as **CouchDB attachments** via direct HTTP PUT/GET
 * against the active shelter database.
 *
 * Each image doc has two attachments:
 *   - "full"  — compressed WebP (max 1024px)
 *   - "thumb" — square-cropped WebP thumbnail (200px)
 */

import {
	allDocsByType,
	getDoc,
	putDoc,
	deleteDoc,
	putAttachment,
	getAttachment
} from '$lib/db/couch-db';
import { makeDoc, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import { compressImage, type CompressOptions } from '$lib/utils/image-compress';
import { isImageDoc, type ImageDoc, type ImageSummary } from '../domain/image';
import type { ImageRepository } from './image.repository';

function toSummary(doc: ImageDoc): ImageSummary {
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
}

export class ImageRemoteRepository implements ImageRepository {
	constructor(private readonly dbName: string) {}

	async saveImage(
		file: File,
		ctx: AuthorContext,
		caption: string = '',
		opts: CompressOptions = {}
	): Promise<ImageSummary> {
		const compressed = await compressImage(file, opts);

		const doc = makeDoc(
			'image',
			1,
			{
				filename: file.name,
				content_type: compressed.full.type || 'image/webp',
				width: compressed.width,
				height: compressed.height,
				original_size: compressed.originalSize,
				compressed_size: compressed.compressedSize,
				thumbnail_size: compressed.thumbnailSize,
				caption
			},
			ctx
		);

		const saved = await putDoc(this.dbName, doc);
		const fullRes = await putAttachment(
			this.dbName,
			saved._id,
			saved._rev!,
			'full',
			compressed.full,
			compressed.full.type || 'image/webp'
		);
		await putAttachment(
			this.dbName,
			saved._id,
			fullRes.rev,
			'thumb',
			compressed.thumbnail,
			compressed.thumbnail.type || 'image/webp'
		);

		return toSummary({ ...saved, _rev: fullRes.rev });
	}

	async listImages(): Promise<ImageSummary[]> {
		const docs = await allDocsByType<ImageDoc>(this.dbName, 'image', isImageDoc);
		return docs.map(toSummary);
	}

	async getImage(id: string): Promise<ImageSummary | null> {
		const doc = await getDoc<ImageDoc>(this.dbName, id);
		return doc && isImageDoc(doc) ? toSummary(doc) : null;
	}

	async getFullImageUrl(id: string): Promise<string | null> {
		const blob = await getAttachment(this.dbName, id, 'full');
		return blob ? URL.createObjectURL(blob) : null;
	}

	async getThumbnailUrl(id: string): Promise<string | null> {
		const blob = await getAttachment(this.dbName, id, 'thumb');
		return blob ? URL.createObjectURL(blob) : null;
	}

	async deleteImage(id: string): Promise<void> {
		await deleteDoc(this.dbName, { _id: id });
	}
}

let singleton: ImageRepository | null = null;
let singletonDbName: string | null = null;

/** Repository bound to the current user's active shelter database. */
export function imageRepository(): ImageRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new ImageRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
