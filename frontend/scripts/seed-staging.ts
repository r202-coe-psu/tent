#!/usr/bin/env tsx
/**
 * Staging seed — master + test users + 3 shelters + ~1,000 Thai faker people + ops.
 *
 * Usage: pnpm seed:staging
 *        pnpm seed:delete-dashboard
 *        pnpm seed:delete-daily-sop
 */
import { mainStaging } from './seed/run-staging';

mainStaging().catch((e: unknown) => {
	console.error('\nStaging seed failed:', e);
	process.exit(1);
});
