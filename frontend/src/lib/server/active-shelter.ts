import { error } from '@sveltejs/kit';
import { hasCapabilityInShelter, shelterCodesFromRoles } from '$lib/auth/roles';

/**
 * Resolve the shelter a BFF request acts on (#477) and prove the caller holds one of
 * `capabilities` IN THAT shelter — not merely somewhere.
 *
 * `requested` is the shelter the client says it is working in (`?shelter_code=`, i.e. the
 * selected shelter). It is never trusted: it must be a shelter where the capability is held.
 *
 * - SA: `requested` as given, or `null` when absent (SA has no shelter of their own — the
 *   route decides whether that means "every shelter" or a 400).
 * - Non-SA with `requested`: that shelter, or 403 when no capability is held there.
 * - Non-SA without `requested`: the caller's only shelter when they belong to exactly one
 *   (the only unambiguous default), 400 when they belong to several.
 *
 * Pure apart from the thrown SvelteKit `HttpError`, so it needs no session to test.
 */
export function resolveActiveShelter(
	roles: readonly string[],
	isSA: boolean,
	requested: string | null | undefined,
	capabilities: readonly string[],
	forbiddenMessage: string
): string | null {
	const code = requested?.trim() || null;
	if (isSA) return code;

	const holdsIn = (shelter: string) =>
		capabilities.some((cap) => hasCapabilityInShelter(roles, shelter, cap));

	if (code) {
		if (!holdsIn(code)) throw error(403, forbiddenMessage);
		return code;
	}

	const own = shelterCodesFromRoles(roles);
	if (own.length === 0) throw error(400, 'Missing shelter_code scope');
	if (own.length > 1) {
		throw error(400, 'shelter_code is required (caller belongs to several shelters)');
	}
	if (!holdsIn(own[0])) throw error(403, forbiddenMessage);
	return own[0];
}
