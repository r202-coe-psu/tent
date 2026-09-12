/**
 * Isomorphic (browser-safe) entry point for the shelters feature.
 *
 * NOTE ON THE NAME: this file is *not* protected by SvelteKit — only
 * `$lib/server/**` is. Vite will happily bundle it into the browser, and
 * `features/shelter-import/domain/import-row.ts` (reached from the root layout)
 * does exactly that. So everything re-exported here MUST be isomorphic.
 * Server-only runtime — anything touching `node:*`, admin credentials, or the
 * filesystem — belongs in `./server/*` and must be imported from its deep path
 * (e.g. `$lib/features/shelters/server/deploy`) by server modules only.
 * Re-exporting `./server/deploy` here once dragged `node:crypto` into the
 * client bundle via `view-lifecycle.ts`; don't put it back.
 *
 * The feature barrel (`$lib/features/shelters`) re-exports the application,
 * data, and UI layers — all of which are browser-only (remote CouchDB client, Svelte, TanStack
 * Query). Importing the barrel from a server module (`$lib/server/**` or
 * `scripts/**`) transitively loads browser-only fetch/session code and crashes with
 * `self is not defined` at module-evaluation time.
 *
 * This file re-exports only the pure domain layer (no I/O, no Svelte, no
 * CouchDB client), so server code can consume the schema and migration helper
 * without dragging in client-only code. The path `$lib/features/shelters/server`
 * intentionally does not match the no-restricted-imports patterns (which only
 * cover domain, data, application, and ui) so it is importable from
 * `src/lib/server/**` without an eslint-disable.
 */

export {
	migrateShelterV2ToCurrent,
	SHELTER_MASTER_SCHEMA_V,
	isShelterBookable,
	resolveOperationStatus,
	createShelterSchema,
	updateShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	DEFAULT_SHELTER_FEATURE_FLAGS,
	type ShelterMaster,
	type ShelterMasterV2,
	type Zone
} from './domain/schema';

export { SHELTER_DASHBOARD_VIEWS } from './domain/views';
export { SHELTER_VIEW_MANIFEST } from './domain/view-manifest';
export type { ShelterViewManifest, CouchViewDefinition } from './domain/view-manifest';
