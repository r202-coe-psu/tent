/**
 * `_security.members` of the central databases `registry` and `catalog`
 * (draft CR central-db-shelter-scope-members).
 *
 * CR-093 makes `shelter:{code}` the database gate and `{code}:{capability}` a
 * `validate_doc_update` concern only, so a shelter scope — not a capability —
 * is what lets a user read the central DBs. Every staff account carries one,
 * flat or compound. Writes stay governed by each DB's own write policy, which
 * must be live before membership widens.
 *
 * Deliberately free of `$env` and `@sveltejs/kit` so plain-`tsx` scripts
 * (`sync-central-db.ts`, seeds) can import it.
 */

import { shelterScopeRole } from '$lib/auth/roles';
import { shelterCodeSchema } from '$lib/db/model';
import { REGISTRY_DESIGN_ID } from './registry-design';

export const CENTRAL_MEMBER_DBS = ['registry', 'catalog'] as const;
export type CentralMemberDb = (typeof CENTRAL_MEMBER_DBS)[number];

/** Flat roles granted before CR-093 — kept so no existing member ever loses access. */
export const LEGACY_CENTRAL_MEMBER_ROLES = [
	'shelter_manager',
	'registration_staff',
	'kitchen_staff',
	'warehouse_staff'
] as const;

/** Design doc that holds each central DB's `validate_doc_update`. */
export const CENTRAL_WRITE_POLICY_DESIGN: Readonly<Record<CentralMemberDb, string>> = {
	registry: REGISTRY_DESIGN_ID,
	catalog: '_design/access'
};

/**
 * Member roles for a central DB: the legacy flat roles plus `shelter:{code}`
 * for every valid shelter code, deduplicated in a stable order. Malformed codes
 * are dropped rather than minted into `_security`.
 */
export function centralMemberRoles(shelterCodes: readonly string[]): string[] {
	const codes = [...new Set(shelterCodes)]
		.filter((code) => shelterCodeSchema.safeParse(code).success)
		.sort();
	return [...LEGACY_CENTRAL_MEMBER_ROLES, ...codes.map(shelterScopeRole)];
}

/** True when a design doc carries a non-empty `validate_doc_update`. */
export function hasWritePolicy(designDoc: unknown): boolean {
	if (!designDoc || typeof designDoc !== 'object') return false;
	const vdu = (designDoc as { validate_doc_update?: unknown }).validate_doc_update;
	return typeof vdu === 'string' && vdu.trim().length > 0;
}

export interface CentralDbAccessSteps {
	/** Deploy registry `_design/app` (views + write policy). */
	deployRegistryPolicy: () => Promise<string>;
	/** Deploy catalog `_design/access` (write policy). */
	deployCatalogPolicy: () => Promise<string>;
	/** Shelter codes currently in the registry. */
	listShelterCodes: () => Promise<string[]>;
	/** Merge `roles` into `db`'s `_security.members` (never removes an entry). */
	mergeMembers: (db: CentralMemberDb, roles: string[]) => Promise<string>;
}

/** Each step's status label, as reported by the caller's step functions. */
export interface CentralDbAccessResult {
	registryPolicy: string;
	catalogPolicy: string;
	shelterCodes: string[];
	security: Record<CentralMemberDb, string>;
}

/**
 * The `pnpm sync:central` access step. Order is the invariant (FR-4): both write
 * policies are deployed before membership widens, so a failed deploy leaves
 * `_security` untouched.
 */
export async function syncCentralDbAccess(
	steps: CentralDbAccessSteps
): Promise<CentralDbAccessResult> {
	const registryPolicy = await steps.deployRegistryPolicy();
	const catalogPolicy = await steps.deployCatalogPolicy();
	const shelterCodes = await steps.listShelterCodes();
	const roles = centralMemberRoles(shelterCodes);
	const security = {} as Record<CentralMemberDb, string>;
	for (const db of CENTRAL_MEMBER_DBS) {
		security[db] = await steps.mergeMembers(db, roles);
	}
	return { registryPolicy, catalogPolicy, shelterCodes, security };
}
