#!/usr/bin/env tsx
/**
 * Default seed entry — aliases to staging profile (backward compatible with `pnpm seed`).
 *
 * Profiles:
 *   pnpm seed:master   — platform master_data + catalog only
 *   pnpm seed:staging  — full staging demo (~1k people)
 *   pnpm seed          — same as seed:staging
 *
 * Needs: CouchDB + COUCHDB_ADMIN_URL in frontend/.env
 */
import { mainStaging } from './seed/run-staging';

mainStaging().catch((e: unknown) => {
	console.error('\nSeed failed:', e);
	process.exit(1);
});
