/**
 * T-34 — Who may drive which referral transitions (DoD: destination accepts capacity).
 *
 * Pure TypeScript — No I/O.
 */

import type { Referral, ReferralStatus } from './referral.schema';
import { canTransition } from './referral.transitions';

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
 * Mirrored copies keep source `shelter_code` but live in the destination DB.
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
 * Capacity accept/reject → destination only (DoD). Capacity send/close (incl. cancel draft) → source.
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

/** UI helper: show Accept/Reject for this actor. */
export function canActorRespond(referral: Referral, actorShelter: string): boolean {
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
