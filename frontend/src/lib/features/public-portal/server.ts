/**
 * Server-safe entry point for the public-portal feature.
 *
 * The feature barrel (`$lib/features/public-portal`) re-exports Svelte UI
 * components (`PublicShelterCard`, `ShelterFilterPanel`, …). Importing that
 * barrel from a `+server.ts` pulls those component modules into the server's
 * SSR module graph even though nothing there renders them — which is what
 * broke CouchDB-era `transparency/summary` when it imported occupancy helpers
 * through the UI barrel. Prefer this module for pure domain helpers from
 * `+server.ts`. Landing metrics themselves now come from FastAPI/Mongo via
 * the BFF proxy — not these CouchDB view helpers.
 */
export {
	countVulnerableFromBirthYearRows,
	FORECAST_OCCUPANCY_STATUSES,
	IN_ZONE_OCCUPANCY_STATUSES,
	isValidThaiBirthYear,
	OCCUPANCY_STATUSES,
	occupancyTripleFromStatusRows,
	PRESENT_OCCUPANCY_STATUSES,
	sumInZoneFromStatusRows,
	sumOccupancyFromStatusRows,
	sumPresentFromStatusRows,
	type OccupancyTriple
} from './domain/transparency-metrics';
