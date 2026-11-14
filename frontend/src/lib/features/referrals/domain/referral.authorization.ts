/**
 * T-34 — Who may drive which referral transitions (DoD: destination accepts capacity).
 *
 * Pure TypeScript — No I/O.
 */

import {
	MEDICAL_STAFF,
	hasCapabilityInShelter,
	isShelterManager,
	isSystemAdmin
} from '$lib/auth/roles';
import type { Referral, ReferralStatus, ReferralType } from './referral.schema';
import { canTransition } from './referral.transitions';
import { isM5Referral } from './referral.m5';

export class ReferralAuthorizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'ReferralAuthorizationError';
	}
}

function sameShelter(a: string, b: string): boolean {
	return a.trim().toUpperCase() === b.trim().toUpperCase();
}

/** Capacity referral that originated at `actorShelter` (outgoing). */
export function isOutgoingCapacityReferral(referral: Referral, actorShelter: string): boolean {
	return referral.referral_type === 'capacity' && sameShelter(referral.shelter_code, actorShelter);
}

/**
 * Capacity referral targeting `actorShelter` (incoming inbox).
 * The referral is stored once in `central_ops`; the incoming side is identified by
 * `to_shelter_code`, while `shelter_code` keeps the source shelter.
 */
export function isIncomingCapacityReferral(referral: Referral, actorShelter: string): boolean {
	return (
		referral.referral_type === 'capacity' &&
		!!referral.to_shelter_code &&
		sameShelter(referral.to_shelter_code, actorShelter) &&
		!sameShelter(referral.shelter_code, actorShelter)
	);
}

/**
 * Whether the actor's shelter may perform `to` on this referral.
 * Capacity accept/reject → destination only (DoD). Capacity send/close (incl. cancel draft and
 * withdraw `sent → closed`, CR-167) → source only; a destination actor gets a 403 on `closed`.
 * Medical/resource respond → source (external org is out-of-band for R3).
 */
export function assertActorMayTransition(
	referral: Referral,
	to: ReferralStatus,
	actorShelter: string
): void {
	if (!canTransition(referral.status, to)) {
		// Domain transition matrix still owns the status error; callers may check first.
		return;
	}

	if (referral.referral_type !== 'capacity') {
		if (!sameShelter(referral.shelter_code, actorShelter)) {
			throw new ReferralAuthorizationError('Only the originating shelter can update this referral');
		}
		return;
	}

	const isSource = sameShelter(referral.shelter_code, actorShelter);
	const isDest = !!referral.to_shelter_code && sameShelter(referral.to_shelter_code, actorShelter);

	if (to === 'accepted' || to === 'rejected') {
		if (!isDest) {
			throw new ReferralAuthorizationError(
				'Only the destination shelter can accept or reject a capacity referral'
			);
		}
		return;
	}

	if (to === 'sent' || to === 'closed') {
		if (!isSource) {
			throw new ReferralAuthorizationError(
				'Only the originating shelter can send or close a capacity referral'
			);
		}
		return;
	}
}

/** UI helper: show Accept/Reject for this actor. Never for M5 referrals (M5 decides, rule 1). */
export function canActorRespond(referral: Referral, actorShelter: string): boolean {
	if (isM5Referral(referral)) return false;
	if (!canTransition(referral.status, 'accepted') && !canTransition(referral.status, 'rejected')) {
		return false;
	}
	try {
		if (canTransition(referral.status, 'accepted')) {
			assertActorMayTransition(referral, 'accepted', actorShelter);
			return true;
		}
		assertActorMayTransition(referral, 'rejected', actorShelter);
		return true;
	} catch (e: unknown) {
		if (e instanceof ReferralAuthorizationError) return false;
		throw e;
	}
}

// ---------------------------------------------------------------------------
// Role → referral type (M5 draft CR D8, D16)
// ---------------------------------------------------------------------------

/**
 * Referral types the caller may see and act on in `shelterCode`, or `null` for all types.
 * SA and shelter managers: all. `medical_staff` (without manager rights): `medical-emergency`
 * only (D8, D16). Anyone else: none (`[]`).
 */
export function referralTypesForRoles(
	roles: readonly string[],
	shelterCode: string | null | undefined
): readonly ReferralType[] | null {
	if (isSystemAdmin(roles) || isShelterManager(roles, shelterCode)) return null;
	if (hasCapabilityInShelter(roles, shelterCode, MEDICAL_STAFF)) return ['medical-emergency'];
	return [];
}

/** True when the caller may create or act on a referral of `type` in `shelterCode`. */
export function canManageReferralType(
	roles: readonly string[],
	shelterCode: string | null | undefined,
	type: ReferralType
): boolean {
	const allowed = referralTypesForRoles(roles, shelterCode);
	return allowed === null || allowed.includes(type);
}
