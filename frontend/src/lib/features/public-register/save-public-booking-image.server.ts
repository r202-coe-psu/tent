/**
 * Persist a compressed face/pet photo as a Couch `image:{ulid}` doc in the
 * target shelter DB via the roleless public writer (public shelter booking).
 *
 * Mirrors onsite `ImageRemoteRepository.saveImage` shape (schema.md §1.6) but
 * never uses the browser AuthSession — anonymous citizens upload through the BFF.
 */
import { makeDoc } from '$lib/db/model';
import {
	deleteAsPublicWriter,
	putAsPublicWriter,
	putAttachmentAsPublicWriter
} from '$lib/server/couch-public-writer';
import { shelterDbName } from '$lib/server/shelter-access-design';

export interface SavePublicBookingImageInput {
	shelterCode: string;
	full: Blob;
	thumb?: Blob | null;
	filename: string;
	contentType: string;
	width: number;
	height: number;
	originalSize: number;
	compressedSize: number;
	thumbnailSize: number;
	caption?: string;
}

export interface SavePublicBookingImageResult {
	photo_id: string;
	content_type: string;
	filename: string;
	width: number;
	height: number;
	original_size: number;
	compressed_size: number;
	thumbnail_size: number;
}

export class PublicBookingImageWriteError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'PublicBookingImageWriteError';
	}
}

export async function savePublicBookingImage(
	input: SavePublicBookingImageInput
): Promise<SavePublicBookingImageResult> {
	const shelterCode = input.shelterCode.trim();
	if (!shelterCode) {
		throw new PublicBookingImageWriteError('SHELTER_REQUIRED');
	}

	const contentType = input.contentType.trim() || 'image/webp';
	const filename = input.filename.trim() || 'photo.webp';
	const dbName = shelterDbName(shelterCode);
	const doc = makeDoc(
		'image',
		1,
		{
			filename,
			content_type: contentType,
			width: input.width,
			height: input.height,
			original_size: input.originalSize,
			compressed_size: input.compressedSize,
			thumbnail_size: input.thumbnailSize,
			caption: input.caption ?? ''
		},
		{ shelterCode, createdBy: 'public' }
	);

	const put = await putAsPublicWriter(dbName, doc._id, doc);
	const putBody = put.data as { ok?: boolean; rev?: string; error?: string } | null;
	if (put.status >= 400 || !putBody?.rev) {
		throw new PublicBookingImageWriteError('WRITE_FAILED');
	}

	let rev = putBody.rev;
	try {
		const fullRes = await putAttachmentAsPublicWriter(
			dbName,
			doc._id,
			rev,
			'full',
			input.full,
			contentType
		);
		rev = fullRes.rev;
		const thumb = input.thumb;
		if (thumb && thumb.size > 0) {
			await putAttachmentAsPublicWriter(
				dbName,
				doc._id,
				rev,
				'thumb',
				thumb,
				thumb.type || 'image/webp'
			);
		}
	} catch {
		await deleteAsPublicWriter(dbName, doc._id, rev).catch(() => {});
		throw new PublicBookingImageWriteError('WRITE_FAILED');
	}

	return {
		photo_id: doc._id,
		content_type: contentType,
		filename,
		width: input.width,
		height: input.height,
		original_size: input.originalSize,
		compressed_size: input.compressedSize,
		thumbnail_size: input.thumbnailSize
	};
}
