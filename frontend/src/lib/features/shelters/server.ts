/**
 * Server-safe entry point for the shelters feature.
 *
 * The feature barrel (`$lib/features/shelters`) re-exports the application,
 * data, and UI layers — all of which are browser-only (PouchDB, Svelte, TanStack
 * Query). Importing the barrel from a server module (`$lib/server/**` or
 * `scripts/**`) transitively loads `pouchdb-browser` and crashes with
 * `self is not defined` at module-evaluation time.
 *
 * This file re-exports only the pure domain layer (no I/O, no Svelte, no
 * PouchDB), so server code can consume the schema and migration helper
 * without dragging in client-only code. The path `$lib/features/shelters/server`
 * intentionally does not match the no-restricted-imports patterns (which only
 * cover domain, data, application, and ui) so it is importable from
 * `src/lib/server/**` without an eslint-disable.
 */

export {
	migrateShelterV2ToCurrent,
	createShelterSchema,
	updateShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	type ShelterMaster,
	type ShelterMasterV2,
	type Zone
} from './domain/schema';

export { SHELTER_DASHBOARD_VIEWS } from './domain/views';
export { deployShelterViewsFn, type CouchClient } from './server/deploy';
