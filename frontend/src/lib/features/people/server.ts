/**
 * Server-safe entry point for the people feature.
 *
 * The feature barrel (`$lib/features/people`) re-exports Svelte UI components
 * and `peopleRepository()` (which reaches into `authStore` for the caller's
 * shelter scope). Importing that barrel from a `+server.ts` drags both into the
 * server's SSR module graph — the same failure documented in
 * `$lib/features/public-portal/server.ts`, and `authStore` has no meaning on an
 * anonymous request anyway.
 *
 * Server code that only needs the pure domain (Zod schemas + doc factories)
 * must import from here. Everything exported below is I/O-free.
 */
export {
	createEvacuee,
	createHousehold,
	evacueeInputSchema,
	householdInputSchema,
	migrateVulnerableGroupCodes,
	admissionSupportsVulnerableGroup
} from './domain/people';

export { registeredViaSchema } from '$lib/db/model';

export type { Evacuee, EvacueeInput, Household, HouseholdInput, StayStatus } from './domain/people';
