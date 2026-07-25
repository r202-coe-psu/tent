import type { AuthorContext } from '$lib/db/model';
import type { CompressOptions } from '$lib/utils/image-compress';
import type { ImageSummary } from '../domain/image';

/**
 * Persistence contract for the `images` feature. The application layer depends
 * on this interface — never on CouchDB directly.
 */
export interface ImageRepository {
	/** Compress a File and store it as an `image` doc with `full`/`thumb` CouchDB attachments. */
	saveImage(
		file: File,
		ctx: AuthorContext,
		caption?: string,
		opts?: CompressOptions
	): Promise<ImageSummary>;
	/** All image docs in the active shelter db (metadata only — no attachment blobs). */
	listImages(): Promise<ImageSummary[]>;
	/** Metadata for a single image, or `null` when absent. */
	getImage(id: string): Promise<ImageSummary | null>;
	/** Full-size attachment as an object URL. Caller must revoke it when done. */
	getFullImageUrl(id: string): Promise<string | null>;
	/** Thumbnail attachment as an object URL. Caller must revoke it when done. */
	getThumbnailUrl(id: string): Promise<string | null>;
	/** Delete an image doc and its attachments. */
	deleteImage(id: string): Promise<void>;
}
