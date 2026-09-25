/**
 * Shared low-level query utilities, actor resolution, and stable operation identity.
 */

import { authStore } from '$lib/stores/auth.svelte';
import { shelterStore } from '$lib/stores/shelter.svelte';
import { getShelterCode } from '$lib/db/shelter';
import type { AuthorContext } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';

export type MaybeGetter<T> = T | (() => T);

export function toValue<T>(valueOrGetter: MaybeGetter<T>): T {
	return typeof valueOrGetter === 'function' ? (valueOrGetter as () => T)() : valueOrGetter;
}

/**
 * Resolves the effective shelter code from an optional override, the shelterStore,
 * or the authenticated user's assigned shelter role fallback.
 */
export function resolveShelterCode(override?: string): string {
	return override ?? shelterStore.selectedShelterCode ?? getShelterCode();
}

/**
 * Creates a stable in-memory operation identifier (ULID) for idempotent workflows.
 * Callers MUST instantiate this ID once in ephemeral UI component state before mutation
 * and reuse the identical ID across sequential retries to prevent duplicate processing.
 */
export function createStableOperationId(): string {
	return ulid();
}

/**
 * Derives authoritative AuthorContext from the authenticated session.
 * Freeform actor name or ID input from UI callers is strictly prohibited.
 * Fails closed if the user is unauthenticated or has no valid username.
 */
export function resolveAuthenticatedAuthorContext(shelterCodeOverride?: string): AuthorContext {
	const user = authStore.user;
	if (!user?.name) {
		throw new Error('Unauthenticated: actor context is required for distribution operations');
	}
	const shelterCode = resolveShelterCode(shelterCodeOverride);
	if (!shelterCode) {
		throw new Error('Shelter context is required for distribution operations');
	}
	return {
		shelterCode,
		createdBy: user.name,
		roles: user.roles ?? []
	};
}
