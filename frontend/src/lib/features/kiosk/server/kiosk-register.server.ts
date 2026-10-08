import { smartCardDataSchema } from '$lib/features/scanners/domain/scanner.schema';
import {
	createKioskEvacueeFromCard,
	type CardSnapshot,
	type Evacuee
} from '$lib/features/people/domain/people';
import { lookupZipcode } from '$lib/server/thailand-location';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { createHash } from 'node:crypto';
import { kioskPhotoPayloadSchema, type KioskPhotoPayload } from '../domain/kiosk-photo';
import { deleteKioskCardImage, putKioskCardImage } from './kiosk-photo.server';
import { z } from 'zod';

export { decodeKioskPhoto, KioskPhotoValidationError } from './kiosk-photo.server';

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
