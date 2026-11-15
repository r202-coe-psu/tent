/* eslint-disable no-restricted-imports */
import { error, json } from '@sveltejs/kit';
import { requireShelterScopeOrSA, type Caller } from '$lib/server/couch-admin';
import {
	MEDICAL_STAFF,
	SHELTER_MANAGER,
	hasCapabilityInShelter,
	isShelterManager
} from '$lib/auth/roles';
import { resolveActiveShelter } from '$lib/server/active-shelter';
import { referralTypesForRoles } from '$lib/features/referrals/domain/referral.authorization';
import type { ReferralType } from '$lib/features/referrals/domain/referral.schema';

/**
 * Shared helper to format, log, and return standardized SvelteKit API endpoint error responses.
 */
export function handleEndpointError(e: unknown, label?: string) {
	void label;
	const err = e as { status?: number; body?: { message?: string }; message?: string };
	const status = err.status || 500;
	const message = err.body?.message || err.message || 'Internal Server Error';
	return json({ error: message }, { status });
}

/**
 * Shared helper to authorize a referral action: system_admin, or `shelter_manager` IN the shelter
 * the request acts on (#477), or `medical_staff` IN that shelter for medical-emergency referrals
 * only (M5 draft CR D8 — routes enforce the type with {@link assertReferralTypeAllowed}).
 * `requestedShelter` is the `?shelter_code=` the client sends (its selected shelter); a manager of SH002 only is refused for SH001, and a multi-shelter manager
 * picks which shelter they work in instead of being pinned to the first `shelter:` role.
 *
 * The returned caller's `shelterCode` IS the resolved active shelter (SA: the requested one, or
 * null when none was given), so {@link resolveShelterCode} and every downstream read of it agree.
 */
export async function authorizeReferral(
	cookie: string | null,
	requestedShelter: string | null
): Promise<Caller> {
	const caller = await requireShelterScopeOrSA(cookie);
	if (
		!caller.isSA &&
		!isShelterManager(caller.roles) &&
		!hasCapabilityInShelter(caller.roles, null, MEDICAL_STAFF)
	) {
		throw error(403, 'Requires shelter_manager, medical_staff or system_admin role');
	}
	const active = resolveActiveShelter(
		caller.roles,
		caller.isSA,
		requestedShelter,
		[SHELTER_MANAGER, MEDICAL_STAFF],
		'Requires shelter_manager or medical_staff in this shelter, or system_admin role'
	);
	return { ...caller, shelterCode: active ?? caller.shelterCode };
}

/**
 * Shared helper to resolve the active shelter code.
 * Throws a 400 error if a System Admin fails to provide an explicit shelter_code,
 * or if a regular manager lacks a shelter scope.
 */
export function resolveShelterCode(caller: Caller, urlShelterCode: string | null): string {
	if (!caller.isSA) {
		if (!caller.shelterCode) throw error(400, 'Missing shelter_code scope');
		return caller.shelterCode;
	}
	if (!urlShelterCode) {
		throw error(400, 'SA must supply shelter_code parameter');
	}
	return urlShelterCode;
}

/** Referral types the caller may see and act on in `shelterCode` (`null` = all; D8, D16). */
export function allowedReferralTypes(
	caller: Caller,
	shelterCode: string
): readonly ReferralType[] | null {
	return caller.isSA ? null : referralTypesForRoles(caller.roles, shelterCode);
}

/** 403 unless the caller may act on a referral of `type` (missing type = legacy medical). */
export function assertReferralTypeAllowed(
	caller: Caller,
	shelterCode: string,
	type: ReferralType | undefined
): void {
	const allowed = allowedReferralTypes(caller, shelterCode);
	if (allowed && !allowed.includes(type ?? 'medical-emergency')) {
		throw error(403, 'Forbidden: referral type not allowed for this role');
	}
}
