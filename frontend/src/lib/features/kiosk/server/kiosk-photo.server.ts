import { adminFetch } from '$lib/server/couch-admin';
import { makeDoc } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import {
	detectImageMime,
	isCanonicalBase64,
	MAX_KIOSK_FULL_PHOTO_BYTES,
	MAX_KIOSK_THUMB_PHOTO_BYTES,
	type KioskPhotoPayload
} from '../domain/kiosk-photo';

export class KioskPhotoValidationError extends Error {
	constructor() {
		super('Kiosk card photo is invalid');
		this.name = 'KioskPhotoValidationError';
	}
}

type DecodedKioskPhoto = { full: Buffer; thumb?: Buffer };

export type KioskCardImageRef = { id: string; rev: string };

/** Decode and verify a smart-card photo payload: canonical base64, declared sizes and real MIME. */
export function decodeKioskPhoto(photo: KioskPhotoPayload): DecodedKioskPhoto {
	if (!isCanonicalBase64(photo.full_base64)) throw new KioskPhotoValidationError();
	const full = Buffer.from(photo.full_base64, 'base64');
	if (
		full.length === 0 ||
		full.length > MAX_KIOSK_FULL_PHOTO_BYTES ||
		full.length !== photo.compressed_size ||
		detectImageMime(full) !== photo.content_type
	) {
		throw new KioskPhotoValidationError();
	}
	let thumb: Buffer | undefined;
	if (photo.thumb_base64 !== undefined) {
		if (!isCanonicalBase64(photo.thumb_base64)) throw new KioskPhotoValidationError();
		thumb = Buffer.from(photo.thumb_base64, 'base64');
		if (
			thumb.length === 0 ||
			thumb.length > MAX_KIOSK_THUMB_PHOTO_BYTES ||
			thumb.length !== photo.thumbnail_size ||
			detectImageMime(thumb) !== 'image/webp'
		) {
			throw new KioskPhotoValidationError();
		}
	} else if (photo.thumbnail_size !== 0) {
		throw new KioskPhotoValidationError();
	}
	return { full, ...(thumb ? { thumb } : {}) };
}

/** Store a validated smart-card photo as a new `image:{ulid}` doc with full/thumb attachments. */
export async function putKioskCardImage(
	dbName: string,
	shelterCode: string,
	deviceId: string,
	photo: KioskPhotoPayload
): Promise<KioskCardImageRef> {
	const decoded = decodeKioskPhoto(photo);
	const id = `image:${ulid()}`;
	const imageDoc = makeDoc(
		'image',
		1,
		{
			filename: 'smart-card-photo.jpg',
			content_type: photo.content_type,
			width: photo.width,
			height: photo.height,
			original_size: photo.original_size,
			compressed_size: decoded.full.length,
			thumbnail_size: decoded.thumb?.length ?? 0,
			caption: 'ภาพจากบัตรประชาชน'
		},
		{ shelterCode, createdBy: `scanner:${deviceId}` },
		id
	);
	const attachments = {
		full: { content_type: photo.content_type, data: decoded.full.toString('base64') },
		...(decoded.thumb
			? { thumb: { content_type: 'image/webp', data: decoded.thumb.toString('base64') } }
			: {})
	};
	const saved = await adminFetch<{ rev?: string }>(`/${dbName}/${encodeURIComponent(id)}`, {
		method: 'PUT',
		body: JSON.stringify({ ...imageDoc, _attachments: attachments })
	});
	if (!saved.rev) throw new Error('CouchDB did not return an image revision');
	return { id, rev: saved.rev };
}

/** Remove an image doc that never got linked to an evacuee (the linking write failed). */
export async function deleteKioskCardImage(
	dbName: string,
	image: KioskCardImageRef
): Promise<void> {
	const query = new URLSearchParams({ rev: image.rev });
	await adminFetch(`/${dbName}/${encodeURIComponent(image.id)}?${query}`, { method: 'DELETE' });
}
