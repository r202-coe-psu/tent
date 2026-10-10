#!/usr/bin/env tsx
/**
 * Distribution demo seed. Scenarios live in `seed/distribution.ts`; I/O in
 * `seed/run-distribution.ts`.
 * - default (desk): dispatched tickets, distribution logs and the matching `stock_ledger` rows
 *   so every tab of `/onsite/distribution` has something to show
 * - `--back-office`: tickets waiting for approval / dispatch plus opening stock lots, so a user
 *   can push them through `/back-office/distribution` until they reach the desk's step 1
 *
 * Usage: pnpm seed:distribution [SHELTER_CODE] [--back-office] [--reset]
 *   SHELTER_CODE   default SH001
 *   --back-office  seed the back-office scenario instead of the desk one
 *   --reset        delete this scenario's docs first, then write them again
 *
 * Needs `pnpm seed:master` (catalog item masters); the desk scenario also needs active
 * evacuees in the shelter DB (`pnpm seed`). Doc ids are fixed, so re-running without --reset is
 * a no-op.
 *
 * LOCAL DEV ONLY — refuses non-local COUCHDB_ADMIN_URL hosts. `--reset` hard-deletes the
 * seeded `stock_ledger` rows (append-only in real data); docs the UI wrote against the
 * seeded tickets afterwards (new logs, receive/return ledger rows) are left behind as
 * orphans — reset right after seeding, or wipe the shelter DB instead.
 */
import { mainDistribution } from './seed/run-distribution';

const args = process.argv.slice(2);

mainDistribution({
	shelterCode: (args.find((a) => !a.startsWith('--')) ?? 'SH001').toUpperCase(),
	scenario: args.includes('--back-office') ? 'back-office' : 'desk',
	reset: args.includes('--reset')
}).catch((e: unknown) => {
	console.error('\nDistribution seed failed:', e);
	process.exit(1);
});
