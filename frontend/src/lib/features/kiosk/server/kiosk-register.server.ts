import { smartCardDataSchema } from '$lib/features/scanners/domain/scanner.schema';
import {
	createKioskEvacueeFromCard,
	type CardSnapshot,
	type Evacuee
} from '$lib/features/people/domain/people';
import { lookupZipcode } from '$lib/server/thailand-location';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { makeDoc } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { createHash } from 'node:crypto';
import {
	detectImageMime,
	isCanonicalBase64,
	kioskPhotoPayloadSchema,
	MAX_KIOSK_FULL_PHOTO_BYTES,
	MAX_KIOSK_THUMB_PHOTO_BYTES,
	type KioskPhotoPayload
} from '../domain/kiosk-photo';
import { z } from 'zod';

export const kioskWalkInRegistrationInputSchema = z
	.object({
		card: smartCardDataSchema.omit({ photo_base64: true }).strict(),
		photo: kioskPhotoPayloadSchema.nullable().default(null),
		consented: z.literal(true),
		consented_at: z
			.string()
			.datetime({ offset: true })
			.refine((timestamp) => Math.abs(Date.now() - Date.parse(timestamp)) <= 10 * 60 * 1000)
	})
	.strict();

export class KioskRegistrationBlockedError extends Error {
	constructor() {
		super('Kiosk registration already exists');
		this.name = 'KioskRegistrationBlockedError';
	}
}

export class KioskPhotoValidationError extends Error {
	constructor() {
		super('Kiosk card photo is invalid');
		this.name = 'KioskPhotoValidationError';
	}
}

type DecodedKioskPhoto = { full: Buffer; thumb?: Buffer };

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

async function putKioskCardImage(
	dbName: string,
	shelterCode: string,
	deviceId: string,
	photo: KioskPhotoPayload
): Promise<{ id: string; rev: string }> {
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

async function deleteKioskCardImage(
	dbName: string,
	image: { id: string; rev: string }
): Promise<void> {
	const query = new URLSearchParams({ rev: image.rev });
	await adminFetch(`/${dbName}/${encodeURIComponent(image.id)}?${query}`, { method: 'DELETE' });
}

/** Age after which an unreleased kiosk registration lock is treated as abandoned (crash, not a live request). */
const LOCK_STALE_AFTER_MS = 30_000;

function isHttpConflict(e: unknown): boolean {
	return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 409;
}

function kioskRegistrationLockId(shelterCode: string, citizenId: string): string {
	const key = `${shelterCode}:${citizenId}`;
	return `kiosk_reg_lock:${createHash('sha256').update(key).digest('hex')}`;
}

/**
 * Reclaim a lock doc left behind by a crashed request. Returns true if a stale
 * doc was found and deleted (caller should retry the acquire once).
 */
async function reclaimStaleLock(dbName: string, lockId: string): Promise<boolean> {
	const existing = await adminFetch<{ _rev?: string; created_at?: string }>(
		`/${dbName}/${encodeURIComponent(lockId)}`
	).catch(() => null);
	if (!existing?._rev || !existing.created_at) return false;
	if (Date.now() - Date.parse(existing.created_at) <= LOCK_STALE_AFTER_MS) return false;
	await adminFetch(`/${dbName}/${encodeURIComponent(lockId)}?rev=${existing._rev}`, {
		method: 'DELETE'
	}).catch(() => {});
	return true;
}

/**
 * Acquire a cross-worker registration lock backed by a CouchDB doc with a
 * deterministic `_id`: CouchDB rejects the second concurrent create with 409,
 * which works across `node:cluster` workers (an in-memory `Map` does not —
 * each worker has its own).
 */
async function acquireKioskRegistrationLock(dbName: string, lockId: string): Promise<string> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await adminFetch<{ rev?: string }>(`/${dbName}/${encodeURIComponent(lockId)}`, {
				method: 'PUT',
				body: JSON.stringify({ type: 'kiosk_reg_lock', created_at: new Date().toISOString() })
			});
			if (!res.rev) throw new Error('CouchDB did not return a lock revision');
			return res.rev;
		} catch (e) {
			if (!isHttpConflict(e)) throw e;
			if (attempt === 0 && (await reclaimStaleLock(dbName, lockId))) continue;
			throw new KioskRegistrationBlockedError();
		}
	}
	throw new KioskRegistrationBlockedError();
}

async function releaseKioskRegistrationLock(
	dbName: string,
	lockId: string,
	rev: string
): Promise<void> {
	await adminFetch(`/${dbName}/${encodeURIComponent(lockId)}?rev=${rev}`, {
		method: 'DELETE'
	}).catch(() => {});
}

/** Create one new kiosk walk-in record after consent; existing records are never reused. */
export async function registerKioskWalkIn(
	shelterCode: string,
	deviceId: string,
	stationName: string,
	cardInput: z.infer<typeof kioskWalkInRegistrationInputSchema>['card'],
	photo: KioskPhotoPayload | null,
	consentedAt: string
): Promise<Evacuee> {
	const citizenId = cardInput.citizen_id;
	const dbName = shelterDbName(shelterCode);
	const lockId = kioskRegistrationLockId(shelterCode, citizenId);
	const lockRev = await acquireKioskRegistrationLock(dbName, lockId);
	try {
		const found = await adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: { type: 'evacuee', 'person_id.number': citizenId, shelter_code: shelterCode },
				limit: 101
			})
		});
		const docs = found.docs ?? [];
		if (docs.length > 100 || docs.some((doc) => typeof doc !== 'object' || doc === null)) {
			throw new KioskRegistrationBlockedError();
		}
		const allRowsMatchQuery = docs.every((doc) => {
			const candidate = doc as {
				type?: unknown;
				shelter_code?: unknown;
				person_id?: { number?: unknown };
			};
			return (
				candidate.type === 'evacuee' &&
				candidate.shelter_code === shelterCode &&
				candidate.person_id?.number === citizenId
			);
		});
		if (!allRowsMatchQuery || docs.length > 0) throw new KioskRegistrationBlockedError();

		let postalCode = cardInput.postal_code;
		if (!postalCode && (cardInput.subdistrict || cardInput.district || cardInput.province)) {
			postalCode =
				lookupZipcode(cardInput.province, cardInput.district, cardInput.subdistrict) ?? null;
		}
		const cardSnapshot: CardSnapshot = {
			citizen_id: citizenId,
			title_th: cardInput.title_th || undefined,
			first_name_th: cardInput.first_name_th || undefined,
			last_name_th: cardInput.last_name_th || undefined,
			gender: cardInput.gender,
			birth_date: cardInput.birth_date || undefined,
			birth_year_ce: cardInput.birth_year_ce ?? undefined,
			age: cardInput.age ?? undefined,
			address_no: cardInput.address_no ?? undefined,
			village_no: cardInput.village_no ?? undefined,
			lane: cardInput.lane ?? undefined,
			road: cardInput.road ?? undefined,
			subdistrict: cardInput.subdistrict ?? undefined,
			district: cardInput.district ?? undefined,
			province: cardInput.province ?? undefined,
			postal_code: postalCode ?? undefined,
			scanned_at: new Date().toISOString(),
			consented_at: consentedAt,
			device_id: deviceId,
			station_name: stationName
		};
		const image = photo ? await putKioskCardImage(dbName, shelterCode, deviceId, photo) : null;
		const evacuee = createKioskEvacueeFromCard(
			cardSnapshot,
			{
				shelterCode,
				createdBy: `scanner:${deviceId}`
			},
			image?.id
		);
		try {
			await adminFetch(`/${dbName}/${encodeURIComponent(evacuee._id)}`, {
				method: 'PUT',
				body: JSON.stringify(evacuee)
			});
		} catch (error) {
			if (image) await deleteKioskCardImage(dbName, image).catch(() => {});
			throw error;
		}
		return evacuee;
	} finally {
		await releaseKioskRegistrationLock(dbName, lockId, lockRev);
	}
}
