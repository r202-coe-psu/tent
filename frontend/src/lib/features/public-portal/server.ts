/**
 * Server-safe entry point for the public-portal feature.
 *
 * The feature barrel (`$lib/features/public-portal`) re-exports Svelte UI
 * components (`PublicShelterCard`, `ShelterFilterPanel`, …). Importing that
 * barrel from a `+server.ts` pulls those component modules into the server's
 * SSR module graph even though nothing there renders them — which is what
 * broke `routes/api/public/v1/transparency/summary/+server.ts` (a circular
 * import through the shared UI kit surfaced as
 * "Class extends value undefined" from an unrelated superforms adapter).
 * Server code that only needs pure domain logic must import from here.
 */
export {
	countVulnerableFromBirthYearRows,
	isValidThaiBirthYear
} from './domain/transparency-metrics';
