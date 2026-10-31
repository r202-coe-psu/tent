import { z } from 'zod';
import { adminFetch } from '$lib/server/couch-admin';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { findMasterByCode } from '$lib/server/shelters.admin';
import { isKioskPetClaimEnabled } from '../domain/kiosk-config';

const LOOKUP_TIMEOUT_MS = 3_000;
const REVERT_TIMEOUT_MS = 3_000;
// The kiosk aborts the whole check-in at 10s; prepare may load GridFS photos, so it gets longer.
const PREPARE_TIMEOUT_MS = 6_000;

const unassignedMemberSchema = z.object({
	reserved_evacuee_id: z.string(),
	first_name: z.string(),
	last_name: z.string(),
	gender: z.string().nullable(),
	age: z.number().nullable(),
	status: z.enum(['open', 'claimed', 'cancelled']),
	claimed_shelter_code: z.string().nullable(),
	matched: z.boolean()
});

const unassignedRegistrationSchema = z.object({
	registration_id: z.string(),
	reserved_household_id: z.string(),
	members: z.array(unassignedMemberSchema)
});

export type UnassignedRegistrationMember = z.infer<typeof unassignedMemberSchema>;
export type UnassignedRegistration = z.infer<typeof unassignedRegistrationSchema>;

/** Exactly one key, mirroring the FastAPI `kiosk-lookup` body. */
export type UnassignedRegistrationQuery =
	{ registration_id: string } | { citizen_id: string } | { evacuee_id: string };

/** The central queue (FastAPI / Mongo) could not answer: network, timeout, 5xx or a bad body. */
export class KioskUnassignedUnavailableError extends Error {
	/** HTTP status when FastAPI answered; absent on network error or timeout. */
	constructor(readonly status?: number) {
		super('Unassigned registration queue unavailable');
		this.name = 'KioskUnassignedUnavailableError';
	}
}

/** A selected member was claimed elsewhere (or is cancelled): nobody is checked in. */
export class KioskUnassignedClaimConflictError extends Error {
	constructor() {
		super('Unassigned registration member is no longer open');
		this.name = 'KioskUnassignedClaimConflictError';
	}
}

/** The citizen the kiosk verified is not a member of the registration. */
export class KioskUnassignedPersonMismatchError extends Error {
	constructor() {
		super('Verified citizen is not a member of the unassigned registration');
		this.name = 'KioskUnassignedPersonMismatchError';
	}
}

/** The claim could not be completed in Couch; the queue claim was reverted. */
export class KioskUnassignedClaimFailedError extends Error {
	constructor() {
		super('Unassigned registration claim failed');
		this.name = 'KioskUnassignedClaimFailedError';
	}
}

/** The registration (any status) the query points at, or `null` when the queue has none. */
export async function findUnassignedRegistration(
	query: UnassignedRegistrationQuery
): Promise<UnassignedRegistration | null> {
	let response: Response;
	try {
		response = await fetch(`${fastapiBaseUrl()}/public/v1/unassigned-registrations/kiosk-lookup`, {
			method: 'POST',
			headers: fastapiServiceHeaders({
				'content-type': 'application/json',
				accept: 'application/json'
			}),
			body: JSON.stringify(query),
			signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS)
		});
	} catch {
		throw new KioskUnassignedUnavailableError();
	}
	if (response.status === 404) return null;
	if (!response.ok) throw new KioskUnassignedUnavailableError();

	const parsed = unassignedRegistrationSchema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) throw new KioskUnassignedUnavailableError();
	return parsed.data;
}

/**
 * FR-KUC-07a: household id of the queue registration that lists `primaryEvacueeId`, or `null` when
 * none does. With `citizenId` the registration is found by that citizen, who must be the primary.
 */
export async function findQueuePrimaryHouseholdId(
	primaryEvacueeId: string,
	citizenId?: string
): Promise<string | null> {
	const registration = await findUnassignedRegistration(
		citizenId ? { citizen_id: citizenId } : { evacuee_id: primaryEvacueeId }
	);
	const member = registration?.members.find((m) => m.reserved_evacuee_id === primaryEvacueeId);
	if (!registration || !member || (citizenId && !member.matched)) return null;
	return registration.reserved_household_id;
}

const couchDocSchema = z.looseObject({ _id: z.string() });

/** A Couch pet row; the schema stays loose so extra fields FastAPI adds still pass through. */
const couchPetSchema = z.looseObject({
	species: z.string(),
	count: z.number(),
	has_cage: z.boolean(),
	notes: z.string().nullish(),
	image_url: z.string().nullish()
});

const preparedClaimSchema = z.object({
	registration_id: z.string(),
	shelter_code: z.string(),
	household: couchDocSchema,
	// Defaults keep an older FastAPI, which knows no pets, parsing (FR-KUC-12b).
	pets: z.array(couchPetSchema).default([]),
	pet_ids: z.array(z.string()).default([]),
	evacuees: z.array(couchDocSchema.extend({ photo: z.string().nullish() })),
	images: z.array(
		z.object({
			doc: couchDocSchema,
			full_b64: z.string(),
			thumb_b64: z.string(),
			content_type: z.string()
		})
	)
});

/** The Couch docs FastAPI built for a claim; the BFF (not FastAPI) writes them. */
export type PreparedUnassignedClaim = z.infer<typeof preparedClaimSchema>;

export type PrepareUnassignedClaimBody = {
	shelter_code: string;
	device_id: string;
	member_ids: string[];
	required_person_id?: string;
	/** FR-KUC-12a: false when the shelter does not take pets; the pets then stay open. */
	claim_pets: boolean;
};

export type RevertUnassignedClaimBody = Omit<
	PrepareUnassignedClaimBody,
	'required_person_id' | 'claim_pets'
> & {
	/** Pets claimed by the prepare being rolled back (FR-KUC-12d); `[]` when none or unknown. */
	pet_ids: string[];
};

function claimUrl(registrationId: string, action: 'prepare' | 'revert'): string {
	return `${fastapiBaseUrl()}/public/v1/unassigned-registrations/${encodeURIComponent(registrationId)}/kiosk-claim/${action}`;
}

async function postClaim(url: string, body: unknown, timeoutMs: number): Promise<Response> {
	try {
		return await fetch(url, {
			method: 'POST',
			headers: fastapiServiceHeaders({
				'content-type': 'application/json',
				accept: 'application/json'
			}),
			body: JSON.stringify(body),
			signal: AbortSignal.timeout(timeoutMs)
		});
	} catch {
		throw new KioskUnassignedUnavailableError();
	}
}

/** FastAPI's `{ errors: [{ error: { code } }] }` envelope; `null` for anything else. */
async function errorCode(response: Response): Promise<string | null> {
	const body = (await response.json().catch(() => null)) as {
		errors?: Array<{ error?: { code?: unknown } | string } | string>;
	} | null;
	const detail = body?.errors?.[0];
	if (typeof detail === 'string') return detail;
	const error = detail?.error;
	if (typeof error === 'string') return error;
	return typeof error?.code === 'string' ? error.code : null;
}

/** FR-KUC-12a: whether the shelter takes pets; any read error fails closed without blocking check-in. */
async function isPetClaimAllowed(shelterCode: string): Promise<boolean> {
	try {
		return isKioskPetClaimEnabled(await findMasterByCode(shelterCode));
	} catch (error) {
		// Without this a registry outage reads as "the shelter takes no pets".
		console.warn('[Kiosk Claim] Shelter registry read failed; pets stay open', {
			shelter_code: shelterCode,
			error: error instanceof Error ? error.name : 'unknown'
		});
		return false;
	}
}

/** Mark the members claimed in the queue and get back the Couch docs to birth. */
export async function prepareUnassignedClaim(
	registrationId: string,
	body: PrepareUnassignedClaimBody
): Promise<PreparedUnassignedClaim> {
	const response = await postClaim(claimUrl(registrationId, 'prepare'), body, PREPARE_TIMEOUT_MS);
	if (response.status === 409) throw new KioskUnassignedClaimConflictError();
	if (response.status === 403 && (await errorCode(response)) === 'PERSON_MISMATCH') {
		throw new KioskUnassignedPersonMismatchError();
	}
	if (!response.ok) throw new KioskUnassignedUnavailableError();

	const parsed = preparedClaimSchema.safeParse(await response.json().catch(() => null));
	if (!parsed.success) throw new KioskUnassignedUnavailableError();
	return parsed.data;
}

/** Put members this device claimed back to open (idempotent). */
export async function revertUnassignedClaim(
	registrationId: string,
	body: RevertUnassignedClaimBody
): Promise<void> {
	const response = await postClaim(claimUrl(registrationId, 'revert'), body, REVERT_TIMEOUT_MS);
	if (!response.ok) throw new KioskUnassignedUnavailableError(response.status);
}

/** Best effort: a failed revert leaves an orphan claim that a later prepare repairs (FR-KUC-15). */
async function revertQuietly(registrationId: string, body: RevertUnassignedClaimBody) {
	try {
		await revertUnassignedClaim(registrationId, body);
	} catch (error) {
		// Ids and the HTTP status only (no status = network error or timeout), never PII.
		console.warn('[Kiosk Claim] Revert failed; claim may be orphaned', {
			registration_id: registrationId,
			member_ids: body.member_ids,
			pet_ids: body.pet_ids,
			status: error instanceof KioskUnassignedUnavailableError ? (error.status ?? null) : null
		});
	}
}

async function findMissingDocIds(dbName: string, docIds: string[]): Promise<string[]> {
	const result = await adminFetch<{
		rows?: Array<{ key?: string; error?: string; value?: { deleted?: boolean } }>;
	}>(`/${dbName}/_all_docs`, { method: 'POST', body: JSON.stringify({ keys: docIds }) });
	const present = new Set(
		(result.rows ?? [])
			.filter((row) => !row.error && row.value && !row.value.deleted)
			.map((row) => row.key)
	);
	return docIds.filter((id) => !present.has(id));
}

/** The Couch write failed; `householdWritten` says whether the household (and so its pets) landed. */
class PreparedClaimWriteError extends Error {
	constructor(readonly householdWritten: boolean) {
		super('Couch rejected the claimed documents');
		this.name = 'PreparedClaimWriteError';
	}
}

const HOUSEHOLD_APPEND_RETRIES = 2;

function isConflict(error: unknown): boolean {
	return (error as { status?: unknown } | null)?.status === 409;
}

/** FR-KUC-12c: the Couch household with the claimed pets after its own, every other field kept. */
function withAppendedPets(
	current: Record<string, unknown>,
	prepared: PreparedUnassignedClaim
): Record<string, unknown> {
	const updatedAt = prepared.household.updated_at;
	return {
		...current,
		pets: [...(Array.isArray(current.pets) ? current.pets : []), ...prepared.pets],
		...(updatedAt === undefined ? {} : { updated_at: updatedAt })
	};
}

/**
 * FR-KUC-12c: append the claimed pets to a household already in Couch — re-read, merge, PUT —
 * retrying on conflict. True once the PUT lands.
 */
async function appendPetsWithRetry(
	dbName: string,
	prepared: PreparedUnassignedClaim
): Promise<boolean> {
	const householdPath = `/${dbName}/${encodeURIComponent(prepared.household._id)}`;
	let attempt = 0;
	while (attempt <= HOUSEHOLD_APPEND_RETRIES) {
		attempt++;
		const latest = await adminFetch<Record<string, unknown>>(householdPath);
		try {
			await adminFetch(householdPath, {
				method: 'PUT',
				body: JSON.stringify(withAppendedPets(latest, prepared))
			});
			return true;
		} catch (error) {
			if (!isConflict(error)) throw error;
		}
	}
	return false;
}

/**
 * Birth the prepared docs in one `_bulk_docs`; a conflict means they were already born. Docs
 * already in Couch are left out first, so a repair claim (FR-KUC-15) never writes the `image:` doc
 * prepare minted afresh for an evacuee that already exists (FR-KUC-10).
 *
 * The claimed pets ride on the household: a new one carries them, one already in Couch gets them
 * appended (FR-KUC-12c). A new household that comes back `conflict` with pets was born by someone
 * else meanwhile without them, so it also takes the append path.
 * Throws `PreparedClaimWriteError` carrying whether the household write (new or append) landed.
 */
async function writePreparedClaim(
	dbName: string,
	prepared: PreparedUnassignedClaim
): Promise<void> {
	const householdId = prepared.household._id;
	const hasPets = prepared.pets.length > 0;
	// Unknown until the household write is known to be unneeded or to have landed.
	let householdWritten = false;
	try {
		const missing = new Set(
			await findMissingDocIds(dbName, [householdId, ...prepared.evacuees.map((doc) => doc._id)])
		);
		const newHousehold = missing.has(householdId);
		householdWritten = !newHousehold && !hasPets;

		const evacuees = prepared.evacuees.filter((doc) => missing.has(doc._id));
		const imageIds = new Set(
			evacuees.map((doc) => doc.photo).filter((id): id is string => Boolean(id))
		);
		// Pet images only go with a household write (FR-KUC-12c); member images stay per evacuee.
		if (hasPets) {
			for (const pet of prepared.pets) if (pet.image_url) imageIds.add(pet.image_url);
		}
		const docs = [
			...(newHousehold ? [prepared.household] : []),
			...evacuees,
			...prepared.images
				.filter((image) => imageIds.has(image.doc._id))
				.map((image) => ({
					...image.doc,
					_attachments: {
						full: { content_type: image.content_type, data: image.full_b64 },
						thumb: { content_type: image.content_type, data: image.thumb_b64 }
					}
				}))
		];
		let failedRows = false;
		if (docs.length > 0) {
			const rows = await adminFetch<Array<{ id?: string; error?: string }>>(
				`/${dbName}/_bulk_docs`,
				{ method: 'POST', body: JSON.stringify({ docs }) }
			);
			if (!Array.isArray(rows)) throw new PreparedClaimWriteError(false);
			if (newHousehold) {
				const householdError = rows.find((row) => row.id === householdId)?.error;
				const bornElsewhere = householdError === 'conflict' && hasPets;
				householdWritten = !householdError || (householdError === 'conflict' && !bornElsewhere);
			}
			failedRows = rows.some((row) => row.error && row.error !== 'conflict');
		}

		if (hasPets && !householdWritten) {
			householdWritten = await appendPetsWithRetry(dbName, prepared);
		}
		if (failedRows || !householdWritten) throw new PreparedClaimWriteError(householdWritten);
	} catch (error) {
		throw error instanceof PreparedClaimWriteError
			? error
			: new PreparedClaimWriteError(householdWritten);
	}
}

/**
 * FR-KUC-07..15: before a kiosk check-in, bring the selected queue members (open, or claimed into
 * this shelter but never born) into this shelter's Couch at `pre_registered`. Nothing selected is
 * missing, or the queue knows none of them: no-op. On any failure the queue claim is reverted and
 * the error propagates so nobody is checked in.
 */
export async function claimUnassignedMembers(
	shelterCode: string,
	deviceId: string,
	evacueeIds: string[],
	options: { requiredPersonId?: string } = {}
): Promise<void> {
	const dbName = shelterDbName(shelterCode);
	const missing = await findMissingDocIds(dbName, [...new Set(evacueeIds)]);
	if (missing.length === 0) return;

	let registration: UnassignedRegistration | null = null;
	for (const evacueeId of missing) {
		registration = await findUnassignedRegistration({ evacuee_id: evacueeId });
		if (registration) break;
	}
	if (!registration) return;
	const toClaim = missing.filter((id) =>
		registration.members.some(
			(member) =>
				member.reserved_evacuee_id === id &&
				(member.status === 'open' ||
					(member.status === 'claimed' && member.claimed_shelter_code === shelterCode))
		)
	);
	if (toClaim.length === 0) return;

	const base = { shelter_code: shelterCode, device_id: deviceId, member_ids: toClaim };
	// The BFF does not know the pet ids until prepare answers, so this revert covers members only.
	const revertBody = { ...base, pet_ids: [] };
	const claimPets = await isPetClaimAllowed(shelterCode);
	let prepared: PreparedUnassignedClaim;
	try {
		prepared = await prepareUnassignedClaim(registration.registration_id, {
			...base,
			claim_pets: claimPets,
			...(options.requiredPersonId ? { required_person_id: options.requiredPersonId } : {})
		});
	} catch (error) {
		// A sent request may have marked the members before the response was lost.
		if (error instanceof KioskUnassignedUnavailableError) {
			if (claimPets) {
				// FR-KUC-12e: pets it may have claimed are not reverted; staff fix them by registration.
				console.warn('[Kiosk Claim] Prepare lost; pets may stay claimed without Couch', {
					registration_id: registration.registration_id,
					shelter_code: shelterCode
				});
			}
			await revertQuietly(registration.registration_id, revertBody);
		}
		throw error;
	}

	try {
		await writePreparedClaim(dbName, prepared);
	} catch (error) {
		// `_bulk_docs` is not atomic: keep the claim of anyone Couch did take, so Mongo matches Couch.
		const unborn = await findMissingDocIds(dbName, toClaim).catch(() => toClaim);
		// FR-KUC-12d: pets follow the household; once it is in Couch they stay claimed.
		const petIds =
			error instanceof PreparedClaimWriteError && error.householdWritten ? [] : prepared.pet_ids;
		if (unborn.length > 0 || petIds.length > 0) {
			await revertQuietly(registration.registration_id, {
				...revertBody,
				member_ids: unborn,
				pet_ids: petIds
			});
		}
		throw new KioskUnassignedClaimFailedError();
	}
}
