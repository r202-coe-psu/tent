import { smartCardDataSchema } from '$lib/features/kiosk-devices/domain/scanner.schema';
import {
	createKioskEvacueeFromCard,
	createKioskWalkInHousehold,
	type CardSnapshot,
	type Evacuee
} from '$lib/features/people/domain/people';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';
import { lookupZipcode } from '$lib/server/thailand-location';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { createHash } from 'node:crypto';
import { makeDocId } from '$lib/db/model';
import {
	consentDecisionSchemaFor,
	resolveRegistrationConsent,
	type ConsentDecision,
	type EvacueeConsent
} from '$lib/features/consent/server';
import { kioskPhotoPayloadSchema, type KioskPhotoPayload } from '../domain/kiosk-photo';
import { normalizeKioskPhone, phoneVariants } from '../domain/phone';
import { walkInAddressKey, walkInRoadsCompatible } from '../domain/walk-in-address';
import { refreshHouseholdStatus } from './kiosk-check-in.server';
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

const CONSENT_FRESH_MS = 10 * 60 * 1000;

/** The kiosk decision (no C4/C5), given within the last 10 minutes; `consented_at` must be its `given_at`. */
const kioskWalkInConsentFields = {
	phone: kioskWalkInPhoneSchema,
	consent: consentDecisionSchemaFor('kiosk').refine(
		(decision) => Math.abs(Date.now() - Date.parse(decision.given_at)) <= CONSENT_FRESH_MS
	),
	consented_at: z.string().datetime({ offset: true })
};

const hasMatchingConsentTime = (input: { consent: { given_at: string }; consented_at: string }) =>
	Date.parse(input.consented_at) === Date.parse(input.consent.given_at);

/** The card read from the chip; `source` may be left out (kiosk clients from before ThaiD walk-in). */
const kioskCardWalkInInputSchema = z
	.object({
		source: z.literal('smart-card').default('smart-card'),
		card: smartCardDataSchema.omit({ photo_base64: true }).strict(),
		photo: kioskPhotoPayloadSchema.nullable().default(null),
		...kioskWalkInConsentFields
	})
	.strict()
	.refine(hasMatchingConsentTime);

/** ThaiD carries only the verified session id; the identity stays on the server, and no photo. */
const kioskThaidWalkInInputSchema = z
	.object({
		source: z.literal('thaid'),
		session_id: z.string().regex(/^[0-9a-f]{32}$/),
		...kioskWalkInConsentFields
	})
	.strict()
	.refine(hasMatchingConsentTime);

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

/** The phone typed at the kiosk already belongs to someone staying in this shelter. */
export class KioskPhoneDuplicateError extends Error {
	constructor() {
		super('Kiosk walk-in phone already in use');
		this.name = 'KioskPhoneDuplicateError';
	}
}

/** Age after which an unreleased kiosk registration lock is treated as abandoned (crash, not a live request). */
const LOCK_STALE_AFTER_MS = 30_000;

function isHttpConflict(e: unknown): boolean {
	return typeof e === 'object' && e !== null && (e as { status?: unknown }).status === 409;
}

type KioskLockKind = 'kiosk_reg_lock' | 'kiosk_addr_lock';

/** Lock doc `_id` (`<kind>:<sha256>`); the kind is also the doc `type`. */
function kioskLockId(kind: KioskLockKind, shelterCode: string, subject: string): string {
	const key = `${shelterCode}:${subject}`;
	return `${kind}:${createHash('sha256').update(key).digest('hex')}`;
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
 * Try once to take a cross-worker kiosk lock (citizen or address) backed by a CouchDB doc with a
 * deterministic `_id`: CouchDB rejects the second concurrent create with 409, which works across
 * `node:cluster` workers (an in-memory `Map` does not — each worker has its own). Returns the
 * lock revision, or `null` while a live request holds it (a stale one is reclaimed).
 */
async function tryAcquireKioskLock(dbName: string, lockId: string): Promise<string | null> {
	for (let attempt = 0; attempt < 2; attempt++) {
		try {
			const res = await adminFetch<{ rev?: string }>(`/${dbName}/${encodeURIComponent(lockId)}`, {
				method: 'PUT',
				body: JSON.stringify({
					type: lockId.split(':')[0],
					created_at: new Date().toISOString()
				})
			});
			if (!res.rev) throw new Error('CouchDB did not return a lock revision');
			return res.rev;
		} catch (e) {
			if (!isHttpConflict(e)) throw e;
			if (attempt === 0 && (await reclaimStaleLock(dbName, lockId))) continue;
			return null;
		}
	}
	return null;
}

/** The citizen lock: a second request for the same citizen is a duplicate registration. */
async function acquireKioskRegistrationLock(dbName: string, lockId: string): Promise<string> {
	const rev = await tryAcquireKioskLock(dbName, lockId);
	if (!rev) throw new KioskRegistrationBlockedError();
	return rev;
}

const ADDRESS_LOCK_ATTEMPTS = 10;
const ADDRESS_LOCK_RETRY_MS = 200;

/**
 * The address lock: another walk-in at the same address is a different person, so wait for them
 * to finish. A plain `Error` (not "already registered") if it stays held, so the kiosk retries.
 */
async function acquireKioskAddressLock(dbName: string, lockId: string): Promise<string> {
	for (let attempt = 0; attempt < ADDRESS_LOCK_ATTEMPTS; attempt++) {
		if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, ADDRESS_LOCK_RETRY_MS));
		const rev = await tryAcquireKioskLock(dbName, lockId);
		if (rev) return rev;
	}
	throw new Error('Kiosk address registration is busy');
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

/**
 * Stay statuses whose phone a walk-in may not reuse: anyone still held by the shelter (the
 * Forecast set). Someone checked out, cancelled, transferred or deceased frees their phone.
 */
const PHONE_HOLDING_STATUSES: ReadonlySet<string> = new Set([
	'pre_registered',
	'kiosk_registered',
	'arriving',
	'active',
	'room_confirmed',
	'temporary_leave'
]);

/**
 * True when an evacuee still held by this shelter already has `phone` (canonical or legacy
 * `+66`). Equality on `phone` keeps the query on the `['type', 'phone']` index (CR-151).
 */
async function isKioskPhoneInUse(
	dbName: string,
	shelterCode: string,
	phone: string
): Promise<boolean> {
	for (const variant of phoneVariants(phone)) {
		const found = await adminFetch<{ docs?: unknown[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: { type: 'evacuee', shelter_code: shelterCode, phone: variant },
				fields: ['_id', 'current_stay'],
				limit: 1000
			})
		});
		const holding = (found.docs ?? []).some((doc) => {
			const status = (doc as { current_stay?: { status?: unknown } } | null)?.current_stay?.status;
			return typeof status === 'string' && PHONE_HOLDING_STATUSES.has(status);
		});
		if (holding) return true;
	}
	return false;
}

/** A household a later walk-in may no longer join: it ended, was cancelled, or was merged away. */
const CLOSED_HOUSEHOLD_STATUSES: ReadonlySet<string> = new Set([
	'cancelled',
	'checked_out',
	'merged'
]);

const ADDRESS_PAGE_SIZE = 200;

/**
 * The household a kiosk created earlier for this card address (`addressKey`; roads must not
 * conflict), when it is still open and its head is an evacuee whose card shows that address,
 * whatever channel registered them; the oldest one if several qualify.
 * Staff-made households, and ones whose head changed, are never joined.
 */
async function findJoinableKioskHousehold(
	dbName: string,
	shelterCode: string,
	cardSnapshot: CardSnapshot,
	addressKey: string
): Promise<string | null> {
	const candidates = new Map<string, Set<string>>();
	let bookmark: string | undefined;
	for (;;) {
		const page = await adminFetch<{ docs?: unknown[]; bookmark?: string }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					shelter_code: shelterCode,
					'card_snapshot.address_no': cardSnapshot.address_no
				},
				fields: ['_id', 'household_id', 'card_snapshot'],
				limit: ADDRESS_PAGE_SIZE,
				...(bookmark ? { bookmark } : {})
			})
		});
		const docs = page.docs ?? [];
		for (const doc of docs) {
			const evacuee = doc as {
				_id?: string;
				household_id?: string;
				card_snapshot?: CardSnapshot;
			} | null;
			if (!evacuee?._id || !evacuee.household_id || !evacuee.card_snapshot) continue;
			if (
				walkInAddressKey(evacuee.card_snapshot) === addressKey &&
				walkInRoadsCompatible(cardSnapshot.road, evacuee.card_snapshot.road)
			) {
				const members = candidates.get(evacuee.household_id) ?? new Set<string>();
				members.add(evacuee._id);
				candidates.set(evacuee.household_id, members);
			}
		}
		if (docs.length < ADDRESS_PAGE_SIZE || !page.bookmark || page.bookmark === bookmark) break;
		bookmark = page.bookmark;
	}

	let oldest: { id: string; createdAt: string } | null = null;
	for (const [householdId, evacueeIds] of candidates) {
		const household = await adminFetch<{
			type?: string;
			shelter_code?: string;
			head_evacuee_id?: string | null;
			created_by?: string;
			created_at?: string;
			status?: string;
		} | null>(`/${dbName}/${encodeURIComponent(householdId)}`).catch(() => null);
		const joinable =
			household?.type === 'household' &&
			household.shelter_code === shelterCode &&
			evacueeIds.has(household.head_evacuee_id ?? '') &&
			household.created_by?.startsWith('scanner:') === true &&
			!CLOSED_HOUSEHOLD_STATUSES.has(household.status ?? '');
		if (!joinable) continue;
		const createdAt = household.created_at ?? '';
		if (!oldest || createdAt < oldest.createdAt) oldest = { id: householdId, createdAt };
	}
	return oldest?.id ?? null;
}

/** Undo the household of a walk-in whose record could not be written (no orphan is left). */
async function deleteKioskHousehold(dbName: string, householdId: string): Promise<void> {
	const path = `/${dbName}/${encodeURIComponent(householdId)}`;
	const saved = await adminFetch<{ _rev?: string }>(path);
	if (saved?._rev) await adminFetch(`${path}?rev=${saved._rev}`, { method: 'DELETE' });
}

/** A walk-in as written: always carries the consent it was registered with. */
export type KioskEvacuee = Evacuee & { consent: EvacueeConsent };

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
 * Write the walk-in: into `joinHouseholdId` when given (that household keeps its head), otherwise
 * into a new household of their own. Nothing of this walk-in is left behind on failure.
 */
async function writeKioskWalkIn(
	dbName: string,
	device: KioskWalkInDevice,
	cardSnapshot: CardSnapshot,
	photo: KioskPhotoPayload | null,
	decision: ConsentDecision,
	phone: string | null,
	joinHouseholdId: string | null
): Promise<KioskEvacuee> {
	const { shelterCode, deviceId } = device;
	const image = photo ? await putKioskCardImage(dbName, shelterCode, deviceId, photo) : null;
	const ctx = { shelterCode, createdBy: `scanner:${deviceId}` };
	const evacueeId = makeDocId('evacuee');
	const consent = resolveRegistrationConsent(
		decision,
		[{ key: 'self', alreadyConsented: false, evacueeId }],
		{ channel: 'kiosk', recordedBy: null }
	).get('self')!;
	const unlinked = createKioskEvacueeFromCard(
		cardSnapshot,
		ctx,
		consent,
		image?.id,
		phone,
		evacueeId
	);
	const household = joinHouseholdId
		? null
		: createKioskWalkInHousehold(unlinked, cardSnapshot, ctx);
	const evacuee: KioskEvacuee = { ...unlinked, household_id: household?._id ?? joinHouseholdId! };
	if (household) {
		try {
			await adminFetch(`/${dbName}/${encodeURIComponent(household._id)}`, {
				method: 'PUT',
				body: JSON.stringify(household)
			});
		} catch (error) {
			if (image) await deleteKioskCardImage(dbName, image).catch(() => {});
			throw error;
		}
	}
	try {
		await adminFetch(`/${dbName}/${encodeURIComponent(evacuee._id)}`, {
			method: 'PUT',
			body: JSON.stringify(evacuee)
		});
	} catch (error) {
		if (household) await deleteKioskHousehold(dbName, household._id).catch(() => {});
		if (image) await deleteKioskCardImage(dbName, image).catch(() => {});
		throw error;
	}
	if (joinHouseholdId) await refreshHouseholdStatus(dbName, joinHouseholdId, shelterCode);
	return evacuee;
}

/**
 * Create one new kiosk walk-in record after consent; existing records are never reused.
 * The snapshot comes from the chip (with its photo) or from ThaiD (never a photo).
 */
export async function registerKioskWalkInSnapshot(
	device: KioskWalkInDevice,
	cardSnapshot: CardSnapshot,
	photo: KioskPhotoPayload | null,
	decision: ConsentDecision,
	phone: string | null
): Promise<KioskEvacuee> {
	const { shelterCode } = device;
	const citizenId = cardSnapshot.citizen_id;
	const dbName = shelterDbName(shelterCode);
	const lockId = kioskLockId('kiosk_reg_lock', shelterCode, citizenId);
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
		if (phone && (await isKioskPhoneInUse(dbName, shelterCode, phone))) {
			throw new KioskPhoneDuplicateError();
		}

		// Walk-ins from one card address share a household: the address lock keeps two kiosks from
		// each creating their own, and is released (in `finally`) before the citizen lock.
		const addressKey = walkInAddressKey(cardSnapshot);
		const addressLockId = addressKey
			? kioskLockId('kiosk_addr_lock', shelterCode, addressKey)
			: null;
		const addressLockRev = addressLockId
			? await acquireKioskAddressLock(dbName, addressLockId)
			: null;
		try {
			const joinHouseholdId = addressKey
				? await findJoinableKioskHousehold(dbName, shelterCode, cardSnapshot, addressKey)
				: null;
			return await writeKioskWalkIn(
				dbName,
				device,
				cardSnapshot,
				photo,
				decision,
				phone,
				joinHouseholdId
			);
		} finally {
			if (addressLockId && addressLockRev) {
				await releaseKioskRegistrationLock(dbName, addressLockId, addressLockRev);
			}
		}
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
	decision: ConsentDecision,
	phone: string | null = null
): Promise<KioskEvacuee> {
	const device = { shelterCode, deviceId, stationName };
	return registerKioskWalkInSnapshot(
		device,
		kioskCardSnapshotFromCard(cardInput, decision.given_at, device),
		photo,
		decision,
		phone
	);
}

/** Register a walk-in from a verified ThaiD session's citizen: no photo. */
export function registerKioskThaidWalkIn(
	device: KioskWalkInDevice,
	citizen: { pid: string; profile?: ThaiDAutofillProfile },
	decision: ConsentDecision,
	phone: string | null
): Promise<KioskEvacuee> {
	return registerKioskWalkInSnapshot(
		device,
		kioskCardSnapshotFromThaid(citizen.pid, citizen.profile, decision.given_at, device),
		null,
		decision,
		phone
	);
}
