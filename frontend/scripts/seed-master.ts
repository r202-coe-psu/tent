#!/usr/bin/env tsx
/**
 * Platform master seed — lookup master_data + catalog/SOP/config only.
 * Safe for prod + staging init (no demo people / shelters / test users).
 *
 * Usage: pnpm seed:master
 */
import { mainMaster } from './seed/run-master';

mainMaster().catch((e: unknown) => {
	console.error('\nMaster seed failed:', e);
	process.exit(1);
});
