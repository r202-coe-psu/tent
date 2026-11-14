import { z } from 'zod';
import { now, type AuthorContext } from '$lib/db/model';
import { buildKioskSelfCheckout, type Evacuee } from '$lib/features/people/domain/people';
import { isListedHouseholdMember } from '../domain/check-in-status';
import {
	isSelfCheckoutEligible,
	KIOSK_CHECKOUT_DESTINATIONS,
	kioskCheckoutDestination,
	kioskCheckoutReason,
	type KioskCheckoutDestination
} from '../domain/self-checkout';
import { adminFetch } from '$lib/server/couch-admin';
import { shelterDbName } from '$lib/server/shelter-access-design';
import {
	evacueeIdSchema,
	getById,
	refreshHouseholdStatus,
	thaidSessionIdSchema,
	type EvacueeDoc
} from './kiosk-check-in.server';

/** #1401: a card / ThaiD holder checks themselves and chosen household members out. No face check. */
export const kioskCheckOutInputSchema = z
	.object({
		primary_evacuee_id: evacueeIdSchema,
		evacuee_ids: z.array(evacueeIdSchema).min(1).max(20),
		source: z.enum(['smart-card', 'thaid']),
		citizen_id: z
			.string()
			.regex(/^\d{13}$/)
			.optional(),
		// The verified ThaiD scan session; the server resolves the citizen id from it (FR-KTD-26).
		thaid_session_id: thaidSessionIdSchema.optional(),
		destination_type: z.enum(KIOSK_CHECKOUT_DESTINATIONS)
	})
	.superRefine((input, ctx) => {
		if (input.source === 'thaid') {
			if (!input.thaid_session_id) {
				ctx.addIssue({
					code: 'custom',
					path: ['thaid_session_id'],
					message: 'thaid_session_id is required for a thaid check-out'
				});
			}
			if (input.citizen_id) {
				ctx.addIssue({
					code: 'custom',
					path: ['citizen_id'],
					message: 'citizen_id is never accepted for a thaid check-out'
				});
			}
			return;
		}
		if (!input.citizen_id) {
			ctx.addIssue({
				code: 'custom',
				path: ['citizen_id'],
				message: 'citizen_id is required for a smart-card check-out'
			});
		}
		if (input.thaid_session_id) {
			ctx.addIssue({
				code: 'custom',
				path: ['thaid_session_id'],
				message: 'thaid_session_id is only accepted for a thaid check-out'
			});
		}
	});

export type KioskCheckOutMemberResult = {
	evacuee_id: string;
	status: 'checked_out' | 'not_eligible' | 'not_found' | 'failed';
	stay_status?: string;
};

/** The primary being checked out is not the citizen the card / ThaiD session verified. */
export class KioskCheckOutIdentityMismatchError extends Error {
	constructor() {
		super('Primary evacuee does not match the verified citizen');
		this.name = 'KioskCheckOutIdentityMismatchError';
	}
}

function responseStatus(error: unknown): number | null {
	if (typeof error !== 'object' || error === null || !('status' in error)) return null;
	const status = (error as { status?: unknown }).status;
	return typeof status === 'number' ? status : null;
}

const normalizeId = (id: string) => `evacuee:${id.slice('evacuee:'.length).toUpperCase()}`;

/** How many times a 409 re-reads the member before giving up (one retry). */
const MAX_WRITE_ATTEMPTS = 2;

type PutResult = { ok?: boolean; rev?: string };

/**
 * Write one member's check-out: evacuee first (its `_rev` is the optimistic lock), then the
 * movement. A movement that cannot be written puts the stay back, so the trail never has a
 * `checked_out` stay without a movement.
 */
async function checkOutMember(
	dbName: string,
	first: EvacueeDoc,
	ctx: AuthorContext,
	reason: string,
	destinationType: KioskCheckoutDestination,
	at: string
): Promise<KioskCheckOutMemberResult> {
	let current: EvacueeDoc = first;
	for (let attempt = 1; attempt <= MAX_WRITE_ATTEMPTS; attempt += 1) {
		if (!isSelfCheckoutEligible(current.current_stay?.status)) {
			return {
				evacuee_id: first._id,
				status: 'not_eligible',
				stay_status: current.current_stay?.status ?? 'unknown'
			};
		}
		let built: ReturnType<typeof buildKioskSelfCheckout>;
		try {
			built = buildKioskSelfCheckout(
				current as unknown as Evacuee,
				ctx,
				reason,
				destinationType,
				at
			);
		} catch {
			return { evacuee_id: first._id, status: 'failed' };
		}

		let written: PutResult;
		try {
			written = await adminFetch<PutResult>(`/${dbName}/${encodeURIComponent(current._id)}`, {
				method: 'PUT',
				body: JSON.stringify(built.evacuee)
			});
		} catch (error) {
			if (responseStatus(error) === 409 && attempt < MAX_WRITE_ATTEMPTS) {
				const latest = await getById(dbName, first._id).catch(() => null);
				if (!latest || latest.shelter_code !== first.shelter_code) {
					return { evacuee_id: first._id, status: 'failed' };
				}
				current = latest;
				continue;
			}
			// A 409 on the last attempt is a concurrent change we will not fight over.
			return responseStatus(error) === 409
				? await conflictResult(dbName, first._id)
				: { evacuee_id: first._id, status: 'failed' };
		}

		try {
			await adminFetch(`/${dbName}/${encodeURIComponent(built.movement._id)}`, {
				method: 'PUT',
				body: JSON.stringify(built.movement)
			});
		} catch {
			await restoreStay(dbName, built.evacuee, current, written.rev);
			return { evacuee_id: first._id, status: 'failed' };
		}
		return {
			evacuee_id: first._id,
			status: 'checked_out',
			stay_status: built.evacuee.current_stay.status
		};
	}
	return { evacuee_id: first._id, status: 'failed' };
}

/** After a lost race: whoever won may already have checked the member out. */
async function conflictResult(
	dbName: string,
	evacueeId: string
): Promise<KioskCheckOutMemberResult> {
	const latest = await getById(dbName, evacueeId).catch(() => null);
	const status = latest?.current_stay?.status;
	return latest && !isSelfCheckoutEligible(status)
		? { evacuee_id: evacueeId, status: 'not_eligible', stay_status: status ?? 'unknown' }
		: { evacuee_id: evacueeId, status: 'failed' };
}

/** Put the stay back as it was read; best effort, a failure is logged by id only. */
async function restoreStay(
	dbName: string,
	written: Evacuee,
	before: EvacueeDoc,
	rev: string | undefined
): Promise<void> {
	try {
		await adminFetch(`/${dbName}/${encodeURIComponent(written._id)}`, {
			method: 'PUT',
			body: JSON.stringify({
				...written,
				...(rev ? { _rev: rev } : {}),
				current_stay: before.current_stay,
				updated_at: now()
			})
		});
	} catch {
		console.warn('[Kiosk Check-out] Could not restore stay after movement failure', written._id);
	}
}

/**
 * Check selected household members out from the kiosk (#1401). The card / ThaiD holder (the
 * primary) must be the verified citizen; each member is written independently and only
 * `active` / `room_confirmed` stays move. Writes a normal `check_out` movement per member; no
 * `station_log`, no QR.
 */
export async function checkOutSelectedMembers(
	shelterCode: string,
	primaryEvacueeId: string,
	evacueeIds: string[],
	options: {
		/** The card's citizen id, or the one a ThaiD session verified; always required. */
		requiredPrimaryCitizenId: string;
		/** Authenticated scanner device (never from a request body). */
		deviceId: string;
		/** Machine name for the movement reason. */
		deviceLabel: string;
		destinationType: KioskCheckoutDestination;
	}
): Promise<KioskCheckOutMemberResult[]> {
	const dbName = shelterDbName(shelterCode);
	const primaryId = normalizeId(primaryEvacueeId);
	const uniqueIds = [...new Set(evacueeIds.map(normalizeId))];

	const primary = await getById(dbName, primaryId);
	if (!primary || primary.shelter_code !== shelterCode) {
		return uniqueIds.map((evacueeId) => ({ evacuee_id: evacueeId, status: 'not_found' }));
	}
	if (primary.person_id?.number !== options.requiredPrimaryCitizenId) {
		throw new KioskCheckOutIdentityMismatchError();
	}

	const ctx: AuthorContext = { shelterCode, createdBy: `scanner:${options.deviceId}` };
	const reason = kioskCheckoutReason(options.deviceLabel);
	const at = now();
	const results: KioskCheckOutMemberResult[] = [];
	for (const evacueeId of uniqueIds) {
		let member: EvacueeDoc | null;
		try {
			member = evacueeId === primary._id ? primary : await getById(dbName, evacueeId);
		} catch {
			results.push({ evacuee_id: evacueeId, status: 'failed' });
			continue;
		}
		if (!member || member.shelter_code !== shelterCode) {
			results.push({ evacuee_id: evacueeId, status: 'not_found' });
			continue;
		}
		const belongsToHousehold =
			member._id === primary._id ||
			(Boolean(primary.household_id) && member.household_id === primary.household_id);
		if (!belongsToHousehold || !isListedHouseholdMember(member)) {
			results.push({ evacuee_id: evacueeId, status: 'not_eligible' });
			continue;
		}
		results.push(await checkOutMember(dbName, member, ctx, reason, options.destinationType, at));
	}

	if (primary.household_id && results.some((result) => result.status === 'checked_out')) {
		await refreshHouseholdStatus(
			dbName,
			primary.household_id,
			shelterCode,
			kioskCheckoutDestination(options.destinationType)
		);
	}
	return results;
}
