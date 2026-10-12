import { smartCardDataSchema } from '$lib/features/kiosk-devices/domain/scanner.schema';
import {
	createKioskEvacueeFromCard,
	type CardSnapshot,
	type Evacuee
} from '$lib/features/people/domain/people';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';
import { lookupZipcode } from '$lib/server/thailand-location';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { createHash } from 'node:crypto';
import { kioskPhotoPayloadSchema, type KioskPhotoPayload } from '../domain/kiosk-photo';
import { normalizeKioskPhone } from '../domain/phone';
import { deleteKioskCardImage, putKioskCardImage } from './kiosk-photo.server';
import { z } from 'zod';

export { decodeKioskPhoto, KioskPhotoValidationError } from './kiosk-photo.server';

/** Optional phone typed at the kiosk: stored canonical (`0xxxxxxxxx`); anything else is rejected. */
const kioskWalkInPhoneSchema = z
	.string()
	.nullable()
	.default(null)
	.transform((raw, ctx) => {
		if (raw === null || raw.trim() === '') return null;
		const phone = normalizeKioskPhone(raw);
		if (!phone) ctx.addIssue({ code: 'custom', message: 'invalid phone' });
		return phone;
	});

const kioskWalkInConsentFields = {
	phone: kioskWalkInPhoneSchema,
	consented: z.literal(true),
	consented_at: z
		.string()
		.datetime({ offset: true })
		.refine((timestamp) => Math.abs(Date.now() - Date.parse(timestamp)) <= 10 * 60 * 1000)
};

/** The card read from the chip; `source` may be left out (kiosk clients from before ThaiD walk-in). */
const kioskCardWalkInInputSchema = z
	.object({
		source: z.literal('smart-card').default('smart-card'),
		card: smartCardDataSchema.omit({ photo_base64: true }).strict(),
		photo: kioskPhotoPayloadSchema.nullable().default(null),
		...kioskWalkInConsentFields
	})
	.strict();

/** ThaiD carries only the verified session id; the identity stays on the server, and no photo. */
const kioskThaidWalkInInputSchema = z
	.object({
		source: z.literal('thaid'),
		session_id: z.string().regex(/^[0-9a-f]{32}$/),
		...kioskWalkInConsentFields
	})
	.strict();

export const kioskWalkInRegistrationInputSchema = z.union([
	kioskCardWalkInInputSchema,
	kioskThaidWalkInInputSchema
]);

export type KioskWalkInRegistrationInput = z.infer<typeof kioskWalkInRegistrationInputSchema>;
type KioskWalkInCardInput = z.infer<typeof kioskCardWalkInInputSchema>['card'];

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

/** The kiosk that took the registration, as written into the snapshot and `created_by`. */
export type KioskWalkInDevice = { shelterCode: string; deviceId: string; stationName: string };

function withPostalCode(snapshot: CardSnapshot): CardSnapshot {
	if (snapshot.postal_code || !(snapshot.subdistrict || snapshot.district || snapshot.province)) {
		return snapshot;
	}
	const postalCode = lookupZipcode(snapshot.province, snapshot.district, snapshot.subdistrict);
	return postalCode ? { ...snapshot, postal_code: postalCode } : snapshot;
}

/** Snapshot of the chip read; the photo travels separately. */
export function kioskCardSnapshotFromCard(
	cardInput: KioskWalkInCardInput,
	consentedAt: string,
	device: KioskWalkInDevice
): CardSnapshot {
	return withPostalCode({
		citizen_id: cardInput.citizen_id,
		title_th: cardInput.title_th || undefined,
		first_name_th: cardInput.first_name_th || undefined,
		last_name_th: cardInput.last_name_th || undefined,
		gender: cardInput.gender ?? undefined,
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
		postal_code: cardInput.postal_code ?? undefined,
		scanned_at: new Date().toISOString(),
		consented_at: consentedAt,
		device_id: device.deviceId,
		station_name: device.stationName
	});
}

/**
 * Snapshot of what ThaiD verified for `citizenId` (the session's `pid`, never the profile's own
 * copy). The profile marks an unknown birth year as 0; such a year (and its age) is left out.
 */
export function kioskCardSnapshotFromThaid(
	citizenId: string,
	profile: ThaiDAutofillProfile | undefined,
	consentedAt: string,
	device: KioskWalkInDevice
): CardSnapshot {
	const birthYearBE = profile && profile.birth_year > 0 ? profile.birth_year : undefined;
	const address = profile?.address;
	return withPostalCode({
		citizen_id: citizenId,
		first_name_th: profile?.first_name || undefined,
		last_name_th: profile?.last_name || undefined,
		gender: profile?.gender ?? undefined,
		birth_year_ce: birthYearBE !== undefined ? birthYearBE - 543 : undefined,
		age: birthYearBE !== undefined ? profile?.age : undefined,
		address_no: address?.address_no || undefined,
		village_no: address?.village_no || undefined,
		subdistrict: address?.subdistrict || undefined,
		district: address?.district || undefined,
		province: address?.province || undefined,
		postal_code: address?.postal_code || undefined,
		scanned_at: new Date().toISOString(),
		consented_at: consentedAt,
		device_id: device.deviceId,
		station_name: device.stationName
	});
}

/**
 * Create one new kiosk walk-in record after consent; existing records are never reused.
 * The snapshot comes from the chip (with its photo) or from ThaiD (never a photo).
 */
export async function registerKioskWalkInSnapshot(
	device: KioskWalkInDevice,
	cardSnapshot: CardSnapshot,
	photo: KioskPhotoPayload | null,
	phone: string | null
): Promise<Evacuee> {
	const { shelterCode, deviceId } = device;
	const citizenId = cardSnapshot.citizen_id;
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

		const image = photo ? await putKioskCardImage(dbName, shelterCode, deviceId, photo) : null;
		const evacuee = createKioskEvacueeFromCard(
			cardSnapshot,
			{
				shelterCode,
				createdBy: `scanner:${deviceId}`
			},
			image?.id,
			phone
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

/** Register a walk-in from the chip read (see `registerKioskWalkInSnapshot`). */
export function registerKioskWalkIn(
	shelterCode: string,
	deviceId: string,
	stationName: string,
	cardInput: KioskWalkInCardInput,
	photo: KioskPhotoPayload | null,
	consentedAt: string,
	phone: string | null = null
): Promise<Evacuee> {
	const device = { shelterCode, deviceId, stationName };
	return registerKioskWalkInSnapshot(
		device,
		kioskCardSnapshotFromCard(cardInput, consentedAt, device),
		photo,
		phone
	);
}

/** Register a walk-in from a verified ThaiD session's citizen: no photo. */
export function registerKioskThaidWalkIn(
	device: KioskWalkInDevice,
	citizen: { pid: string; profile?: ThaiDAutofillProfile },
	consentedAt: string,
	phone: string | null
): Promise<Evacuee> {
	return registerKioskWalkInSnapshot(
		device,
		kioskCardSnapshotFromThaid(citizen.pid, citizen.profile, consentedAt, device),
		null,
		phone
	);
}
